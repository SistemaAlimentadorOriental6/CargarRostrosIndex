import mysql from 'mysql2/promise';
import { config } from './src/config';

async function inspectTable() {
    console.log('--- Inspecting informacion_empleados ---');
    try {
        const connection = await mysql.createConnection({
            host: config.db.produccion.host,
            user: config.db.produccion.user,
            password: config.db.produccion.password,
            database: config.db.produccion.database,
            port: config.db.produccion.port
        });

        const [columns] = await connection.query('SHOW COLUMNS FROM informacion_empleados');
        console.log('Columnas encontradas:');
        console.table(columns);

        await connection.end();
    } catch (error: any) {
        console.error('❌ Error al inspeccionar:', error.message);
    }
}

inspectTable();
