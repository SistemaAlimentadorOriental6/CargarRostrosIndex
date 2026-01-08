import Fastify from 'fastify';
import { config } from './config';
import { PhashService } from './services/phash.service';
import { SyncService } from './services/sync.service';

const fastify = Fastify({
    logger: true // Logger básico de Fastify para ver requests en consola
});

const phashService = new PhashService();
const syncService = new SyncService();

// Ruta de prueba
fastify.get('/', async (request, reply) => {
    return { hello: 'world', service: 'Carga Datos Service' };
});

// Ruta para disparar la actualización de pHash (Solo existentes)
fastify.post('/jobs/update-phash', async (request, reply) => {
    try {
        const resultado = await phashService.updateExistingPhashes();
        return { success: true, resultado };
    } catch (error: any) {
        request.log.error(error);
        reply.code(500).send({ success: false, error: error.message });
    }
});

// Ruta para sincronizar empleados (Carga nuevos + Actualiza fotos si cambiaron)
fastify.post('/jobs/sync-employees', async (request, reply) => {
    try {
        // Ejecutar sincronización
        const resultado = await syncService.syncEmployees();
        return { success: true, resultado };
    } catch (error: any) {
        request.log.error(error);
        reply.code(500).send({ success: false, error: error.message });
    }
});

const startBackgroundSync = async () => {
    console.log(`📡 Sincronización automática iniciada (cada ${config.sync.intervalMs / 60000} minutos)`);

    while (true) {
        try {
            console.log(`⏱️ [${new Date().toLocaleString()}] Iniciando ciclo de validación...`);
            await syncService.syncEmployees();
            console.log(`✅ [${new Date().toLocaleString()}] Ciclo completado. Esperando próxima ejecución...`);
        } catch (error) {
            console.error('❌ Error en el ciclo de sincronización:', error);
        }

        // Esperar el intervalo configurado
        await new Promise(resolve => setTimeout(resolve, config.sync.intervalMs));
    }
};

const start = async () => {
    try {
        await fastify.listen({ port: config.server.port, host: config.server.host });
        console.log(`Servidor corriendo en http://${config.server.host}:${config.server.port}`);

        // Iniciar la sincronización en segundo plano sin bloquear el servidor
        startBackgroundSync();
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
