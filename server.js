const mysql = require('mysql2/promise');

const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', // Sem senha no XAMPP
    database: 'barberpro'
});

module.exports = db;