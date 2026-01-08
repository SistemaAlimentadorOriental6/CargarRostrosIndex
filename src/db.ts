import mysql from 'mysql2/promise';
import { config } from './config';

export const createConnection = async () => {
    try {
        const connection = await mysql.createConnection({
            host: config.db.host,
            user: config.db.user,
            password: config.db.password,
            database: config.db.database,
            port: config.db.port
        });
        console.log('✅ Conexión a base de datos Biometrica establecida correctamente');
        return connection;
    } catch (error) {
        console.error('❌ Error conectando a la base de datos Biometrica:', error);
        throw error;
    }
};

export const getDbPool = () => {
    return mysql.createPool({
        host: config.db.host,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        port: config.db.port,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
};

export const getProduccionPool = () => {
    return mysql.createPool({
        host: config.db.produccion.host,
        user: config.db.produccion.user,
        password: config.db.produccion.password,
        database: config.db.produccion.database,
        port: config.db.produccion.port,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
};
