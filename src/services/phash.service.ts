import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { getDbPool } from '../db';
import { computePhash } from '../utils/image-processor';
import { RowDataPacket } from 'mysql2';

interface RostroIndexado extends RowDataPacket {
    id: number;
    ruta_imagen_original: string;
    cedula: string;
    external_image_id: string;
    phash: string | null;
}

export class PhashService {
    private pool = getDbPool();

    /**
     * Descarga una imagen y calcula su pHash
     */
    async calculatePhashFromUrl(url: string): Promise<string | null> {
        // Usar un nombre de archivo único para evitar colisiones en threads concurrentes
        const tempPath = path.join(os.tmpdir(), `temp_phash_${crypto.randomBytes(8).toString('hex')}.jpg`);

        try {
            console.log(`🔄 Procesando: ${url}`);

            // Descargar imagen con Axios
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                timeout: 10000,
                // Validar status
                validateStatus: (status) => status === 200
            });

            // Verificar Content-Length si existe (opcional, pero útil)
            const contentLength = response.headers['content-length'];
            if (contentLength && parseInt(contentLength) < 1000) {
                console.log(`   ⚠️ Imagen muy pequeña (${contentLength} bytes). Ignorando.`);
                return null;
            }

            // Guardar en disco temporalmente
            const writer = fs.createWriteStream(tempPath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // Calcular pHash usando nuestra implementación robusta (dHash)
            const hash = await computePhash(tempPath);

            console.log(`   ✔ pHash obtenido: ${hash}`);
            return hash;

        } catch (error: any) {
            console.error(`   ❌ Error procesando ${url}: ${error.message}`);
            return null;
        } finally {
            // Limpiar archivo temporal siempre
            if (fs.existsSync(tempPath)) {
                try {
                    fs.unlinkSync(tempPath);
                } catch (e) {
                    // Ignorar error de borrado
                }
            }
        }
    }

    /**
     * Actualiza los pHash de todos los registros existentes en la BD
     */
    async updateExistingPhashes() {
        console.log('🚀 Iniciando actualización masiva de pHash para registros existentes...');

        const connection = await this.pool.getConnection();

        try {
            // Obtener todos los registros activos
            const [rows] = await connection.query<RostroIndexado[]>(
                'SELECT id, ruta_imagen_original, cedula, external_image_id FROM rostros_indexados WHERE activo = 1'
            );

            console.log(`📊 Se encontraron ${rows.length} registros para procesar.`);

            let procesados = 0;
            let actualizados = 0;
            let errores = 0;

            // Procesar secuencialmente para no sobrecargar
            for (const row of rows) {
                procesados++;

                if (!row.ruta_imagen_original) {
                    console.log(`⚠️ Registro ${row.id} (${row.cedula}) sin URL de imagen. Saltando.`);
                    continue;
                }

                const phash = await this.calculatePhashFromUrl(row.ruta_imagen_original);

                if (phash) {
                    await connection.execute(
                        'UPDATE rostros_indexados SET phash = ? WHERE id = ?',
                        [phash, row.id]
                    );
                    actualizados++;
                } else {
                    errores++;
                }

                // Log de progreso cada 10 registros
                if (procesados % 10 === 0) {
                    console.log(`Progreso: ${procesados}/${rows.length} (${actualizados} actualizados, ${errores} errores)`);
                }
            }

            console.log('\n🏁 Proceso finalizado.');
            console.log(`Total: ${rows.length}`);
            console.log(`Actualizados: ${actualizados}`);
            console.log(`Errores/Sin imagen: ${errores}`);

            return {
                total: rows.length,
                actualizados,
                errores
            };

        } catch (error) {
            console.error('❌ Error fatal en updateExistingPhashes:', error);
            throw error;
        } finally {
            connection.release();
        }
    }
}
