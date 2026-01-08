import dotenv from 'dotenv';
import path from 'path';

// Cargar y verificar variables
const result = dotenv.config({ path: path.resolve(__dirname, '../.env') });
if (result.error) {
    console.warn('⚠️ No se pudo cargar el archivo .env:', result.error.message);
}

export const config = {
    server: {
        port: parseInt(process.env.PORT || '1010', 10),
        host: '0.0.0.0'
    },
    db: {
        // Datos de la base de datos BIOMÉTRICA (Destino)
        host: process.env.DB_BIOMETRICA_HOST || '127.0.0.1',
        port: parseInt(process.env.DB_BIOMETRICA_PORT || '3306', 10),
        user: process.env.DB_BIOMETRICA_USERNAME || 'root',
        password: process.env.DB_BIOMETRICA_PASSWORD || '',
        database: process.env.DB_BIOMETRICA_DATABASE || 'biometrica',

        // Datos de la base de datos de PRODUCCIÓN (Fuente de empleados)
        produccion: {
            host: process.env.DB_PRODUCCION_HOST || '127.0.0.1',
            user: process.env.DB_PRODUCCION_USER || 'root', // Cambiado a _USER para coincidir con tu .env
            password: process.env.DB_PRODUCCION_PASSWORD || '',
            database: process.env.DB_PRODUCCION_DATABASE || 'produccion',
            port: parseInt(process.env.DB_PRODUCCION_PORT || '3306', 10)
        }
    },
    aws: {
        region: process.env.AWS_REGION || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        collectionId: process.env.AWS_COLLECTION_ID || 'empleados-sao6'
    },
    sync: {
        intervalMs: parseInt(process.env.SYNC_INTERVAL_MS || '5000', 10)
    }
};

// Log para depuración (sin mostrar contraseñas)
console.log('🔍 Configuración cargada:');
console.log(`   - DB Biometrica: ${config.db.host}:${config.db.port} (User: ${config.db.user})`);
console.log(`   - DB Produccion: ${config.db.produccion.host}:${config.db.produccion.port} (User: ${config.db.produccion.user})`);
