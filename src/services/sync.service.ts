import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { getDbPool, getProduccionPool } from '../db';
import { computePhash } from '../utils/image-processor';
import { AwsRekognitionService } from './aws.service';
import { config } from '../config';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

interface EmpleadoActivo extends RowDataPacket {
    nro_identificacion: string;
    foto: string;
    estado_empleado: string;
}

interface RostroIndexado extends RowDataPacket {
    id: number;
    ruta_imagen_original: string;
    cedula: string;
    external_image_id: string;
    phash: string | null;
    metadatos_aws: string | null;
}

export class SyncService {
    private localPool = getDbPool();
    private produccionPool = getProduccionPool();
    private awsService = new AwsRekognitionService();

    /**
     * Descarga una imagen temporalmente
     */
    private async downloadImage(url: string): Promise<string | null> {
        const tempPath = path.join(os.tmpdir(), `sync_${crypto.randomBytes(8).toString('hex')}.jpg`);
        try {
            const response = await axios({
                url, method: 'GET', responseType: 'stream', timeout: 15000,
                validateStatus: (status) => status === 200
            });

            const contentLength = response.headers['content-length'];
            if (contentLength && parseInt(contentLength) < 1000) return null;

            const writer = fs.createWriteStream(tempPath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            return tempPath;
        } catch (error) {
            return null;
        }
    }

    /**
     * Sincroniza empleados activos:
     * 1. Obtiene empleados activos de Producción
     * 2. Compara URLs para detección rápida de cambios
     * 3. Si hay cambio: borra rostro viejo en AWS, descarga, indexa nuevo y actualiza BD
     */
    async syncEmployees() {
        console.log('🚀 Iniciando sincronización optimizada de empleados activos...');
        const connProd = await this.produccionPool.getConnection();
        const connLocal = await this.localPool.getConnection();

        try {
            // 0. LIMPIEZA PREVIA: Eliminar duplicados en BD (Dejar solo el último insertado por cédula)
            await connLocal.execute(`
                DELETE r1 FROM rostros_indexados r1 
                INNER JOIN rostros_indexados r2 
                WHERE r1.id < r2.id AND r1.cedula = r2.cedula AND r1.activo = 1 AND r2.activo = 1
            `);
            console.log('🧹 Limpieza inicial de duplicados completada.');

            // 1. Cargar mapa local de rostros indexados
            const [localRows] = await connLocal.query<RostroIndexado[]>(
                'SELECT id, cedula, face_id, ruta_imagen_original, phash, metadatos_aws FROM rostros_indexados WHERE activo = 1'
            );

            const localMap = new Map<string, RostroIndexado[]>();
            localRows.forEach(row => {
                const cedulaStr = String(row.cedula).trim();
                const current = localMap.get(cedulaStr) || [];
                current.push(row);
                localMap.set(cedulaStr, current);
            });

            // 2. Obtener empleados activos de Producción (Agrupados por cédula para evitar duplicados de origen)
            const [empleados] = await connProd.query<EmpleadoActivo[]>(
                `SELECT nro_identificacion, MAX(foto) as foto, MAX(estado_empleado) as estado_empleado 
                 FROM informacion_empleados 
                 WHERE estado_empleado = 'ACTIVO' AND foto IS NOT NULL AND foto != ''
                 GROUP BY nro_identificacion`
            );

            console.log(`📊 Total en Producción (únicos): ${empleados.length} | Ya indexados localmente: ${localRows.length}`);

            let nuevos = 0, actualizados = 0, errores = 0, ignorados = 0;
            const cedulasProcesadas = new Set<string>();

            for (const emp of empleados) {
                const cedula = String(emp.nro_identificacion).trim();

                // Evitar procesar la misma cédula dos veces en la misma corrida
                if (cedulasProcesadas.has(cedula)) continue;
                cedulasProcesadas.add(cedula);

                const urlImagen = `https://admon.sao6.com.co/web${emp.foto}`;
                const externalId = `cedula_${cedula}`;

                const registrosLocales = localMap.get(cedula) || [];
                let requiereProcesamiento = false;
                let motivo = '';

                // --- NUEVO: Validación por Metadatos HTTP (HEAD) ---
                let httpMetadata = { size: '0', mtime: '' };
                try {
                    const headRes = await axios.head(urlImagen, { timeout: 5000 });
                    httpMetadata.size = String(headRes.headers['content-length'] || '0');
                    httpMetadata.mtime = String(headRes.headers['last-modified'] || '');
                } catch (e) {
                    console.log(`   ⚠️ No se pudo obtener HEAD para ${urlImagen}`);
                }

                // Buscar si ya existe un registro con esta URL exacta
                const matchPorUrl = registrosLocales.find(r => r.ruta_imagen_original === urlImagen);

                if (matchPorUrl) {
                    // Verificamos si los metadatos HTTP han cambiado desde la última vez
                    let metadatosGuardados: any = {};
                    try { metadatosGuardados = JSON.parse(matchPorUrl.metadatos_aws || '{}'); } catch (e) { }

                    const sizeIgual = metadatosGuardados.http_size === httpMetadata.size;
                    const mtimeIgual = metadatosGuardados.http_mtime === httpMetadata.mtime;

                    if (sizeIgual && mtimeIgual && matchPorUrl.phash) {
                        ignorados++;
                        continue; // No hay cambios físicos en la imagen
                    }

                    requiereProcesamiento = true;
                    motivo = 'METADATOS HTTP CAMBIARON (MISMA URL)';
                } else if (registrosLocales.length === 0) {
                    requiereProcesamiento = true;
                    motivo = 'NUEVO USUARIO';
                } else {
                    requiereProcesamiento = true;
                    motivo = 'URL DE FOTO CAMBIÓ';
                }

                if (!requiereProcesamiento) {
                    ignorados++;
                    continue;
                }

                console.log(`⚡ Validando ${cedula}: ${motivo}`);

                // Descargar imagen temporal
                const tempPath = await this.downloadImage(urlImagen);
                if (!tempPath) {
                    console.log(`   ⚠️ No se pudo descargar imagen para ${cedula}. Saltando.`);
                    errores++;
                    continue;
                }

                const nuevoPhash = await computePhash(tempPath);

                // 3. Verificación secundaria: ¿Coincide el pHash con ALGUNO de los registros existentes?
                const matchPorPhash = registrosLocales.find(r => r.phash === nuevoPhash);
                if (matchPorPhash) {
                    console.log(`   ℹ️ El pHash coincide con registro existente. Actualizando URL y metadatos.`);

                    // Actualizamos la URL y los metadatos HTTP para evitar futuras descargas
                    let metadataUpdate: any = {};
                    try { metadataUpdate = JSON.parse(matchPorPhash.metadatos_aws || '{}'); } catch (e) { }
                    metadataUpdate.http_size = httpMetadata.size;
                    metadataUpdate.http_mtime = httpMetadata.mtime;

                    await connLocal.execute(
                        'UPDATE rostros_indexados SET ruta_imagen_original = ?, metadatos_aws = ?, fecha_actualizacion = NOW() WHERE id = ?',
                        [urlImagen, JSON.stringify(metadataUpdate), matchPorPhash.id]
                    );

                    // Limpiamos duplicados
                    const duplicados = registrosLocales.filter(r => r.id !== matchPorPhash.id);
                    for (const dup of duplicados) {
                        if (dup.face_id) await this.awsService.deleteFace(dup.face_id);
                        await connLocal.execute('UPDATE rostros_indexados SET activo = 0 WHERE id = ?', [dup.id]);
                    }

                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                    ignorados++;
                    continue;
                }

                // --- ACCIÓN: NUEVA INDEXACIÓN ---

                if (registrosLocales.length > 0) {
                    console.log(`   ♻️ Reemplazando ${registrosLocales.length} registros anteriores...`);
                    for (const row of registrosLocales) {
                        if (row.face_id) await this.awsService.deleteFace(row.face_id);
                    }
                    await connLocal.execute('UPDATE rostros_indexados SET activo = 0 WHERE cedula = ?', [cedula]);
                }

                // Indexar en AWS
                const awsResult = await this.awsService.indexFace(tempPath, externalId, config.aws.collectionId);

                if (awsResult.success && awsResult.faceId) {
                    // Mezclamos metadatos de AWS con nuestros metadatos HTTP
                    const finalMetadata = {
                        ...awsResult.details,
                        http_size: httpMetadata.size,
                        http_mtime: httpMetadata.mtime
                    };

                    await connLocal.execute(
                        `INSERT INTO rostros_indexados 
                        (face_id, external_image_id, nombre_coleccion, ruta_imagen_original, nombre_persona, cedula, confianza, metadatos_aws, phash, activo, fecha_indexacion, fecha_actualizacion, usuario_indexo) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW(), 'SISTEMA_SYNC')`,
                        [
                            awsResult.faceId, externalId, config.aws.collectionId, urlImagen,
                            `EMPLEADO ${cedula}`, cedula, awsResult.confidence,
                            JSON.stringify(finalMetadata), nuevoPhash
                        ]
                    );

                    if (motivo === 'NUEVO USUARIO') nuevos++; else actualizados++;
                    console.log(`   ✅ Sincronizado correctamente`);
                } else {
                    console.error(`   ❌ Error AWS: ${awsResult.error}`);
                    errores++;
                }

                // Limpiar
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            }

            console.log('\n🏁 Resumen de Sincronización:');
            console.log(`   - Nuevos: ${nuevos} | Actualizados: ${actualizados} | Ignorados: ${ignorados} | Errores: ${errores}`);

            return { nuevos, actualizados, ignorados, errores };

        } catch (error) {
            console.error('Error fatal en sincronización:', error);
            throw error;
        } finally {
            connProd.release();
            connLocal.release();
        }
    }
}
