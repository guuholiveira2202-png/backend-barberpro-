const express = require('express');
const path = require('path');
const cors = require('cors'); // Adicionado para permitir conexão do Front-end
const db = require('./db');
const app = express();

// Configurações de Middlewares
app.use(cors()); // Ativa o CORS para evitar erros de bloqueio no navegador
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* =========================================
   AUTENTICAÇÃO (BARBEIRO)
========================================= */
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const [existentes] = await db.query('SELECT * FROM usuarios WHERE email = ?', [email]);
        if (existentes.length > 0) return res.status(400).json({ error: 'Este e-mail já está cadastrado!' });
        const [resultado] = await db.query('INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)', [name, email, password]);
        res.json({ message: 'Conta criada!', user: { id: resultado.insertId, name, email }});
    } catch (error) { res.status(500).json({ error: 'Erro no banco' }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [usuarios] = await db.query('SELECT * FROM usuarios WHERE email = ? AND senha = ?', [email, password]);
        if (usuarios.length > 0) res.json({ message: `Bem-vindo, ${usuarios[0].nome}!`, user: { id: usuarios[0].id, name: usuarios[0].nome, email: usuarios[0].email } });
        else res.status(401).json({ error: 'Login incorreto!' });
    } catch (error) { res.status(500).json({ error: 'Erro no banco' }); }
});

/* =========================================
   DASHBOARD
========================================= */
app.get('/api/dashboard', async (req, res) => {
    try {
        const [agendamentos] = await db.query(`SELECT a.id, a.cliente, a.servico, a.barbeiro, DATE_FORMAT(a.data, '%Y-%m-%d') as data, a.status, s.preco FROM agendamentos a LEFT JOIN servicos s ON a.servico = s.nome ORDER BY a.data DESC LIMIT 10`);
        const [caixa] = await db.query(`SELECT SUM(CASE WHEN tipo = 'Entrada' THEN valor ELSE 0 END) as entradas, SUM(CASE WHEN tipo = 'Saída' THEN valor ELSE 0 END) as saidas FROM transacoes`);
        const saldoTotal = (caixa[0].entradas || 0) - (caixa[0].saidas || 0);
        const [grafico] = await db.query(`SELECT DATE_FORMAT(data, '%d/%m') as dia, SUM(valor) as total FROM transacoes WHERE tipo = 'Entrada' AND data >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY data ORDER BY data ASC`);
        const [totalClientes] = await db.query('SELECT COUNT(*) as total FROM clientes');
        
        res.json({ saldoTotal: saldoTotal.toFixed(2), clientes: totalClientes[0].total, agendamentos, grafico });
    } catch (error) { res.status(500).json({ error: 'Erro no Dashboard' }); }
});

/* =========================================
   CLIENTES
========================================= */
app.get('/api/clientes', async (req, res) => {
    try { const [clientes] = await db.query('SELECT * FROM clientes ORDER BY nome ASC'); res.json(clientes); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clientes', async (req, res) => {
    try { await db.query('INSERT INTO clientes (nome, email, telefone) VALUES (?, ?, ?)', [req.body.nome, req.body.email, req.body.telefone]); res.json({ message: 'Cliente salvo!' }); } catch (e) { res.status(500).json({ error: e.message }); }
});

/* =========================================
   ASSINATURAS E AGENDAMENTOS
========================================= */
app.get('/api/assinaturas', async (req, res) => {
    try {
        const [assinaturas] = await db.query("SELECT id, cliente, plano, valor, DATE_FORMAT(data_adesao, '%Y-%m-%d') as data, status FROM assinaturas ORDER BY id DESC");
        const [mrr] = await db.query("SELECT SUM(valor) as total_recorrente FROM assinaturas WHERE status = 'Ativo'");
        res.json({ assinaturas, mrr: mrr[0].total_recorrente || 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/assinaturas', async (req, res) => {
    try {
        const { cliente, plano, valor, data } = req.body;
        await db.query('INSERT INTO assinaturas (cliente, plano, valor, data_adesao) VALUES (?, ?, ?, ?)', [cliente, plano, valor, data]);
        await db.query('INSERT INTO transacoes (tipo, descricao, valor, data) VALUES (?, ?, ?, ?)', ['Entrada', `Mensalidade: ${plano} (${cliente})`, valor, data]);
        res.json({ message: 'Clube VIP ativado!' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agendamentos', async (req, res) => {
    try { await db.query('INSERT INTO agendamentos (cliente, servico, barbeiro, data, status) VALUES (?, ?, ?, ?, ?)', [req.body.cliente, req.body.servico, req.body.barbeiro, req.body.data, 'Pendente']); res.json({ message: 'Agendado!' }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/agendamentos/:id/concluir', async (req, res) => {
    try {
        const [ag] = await db.query('SELECT a.*, s.preco FROM agendamentos a LEFT JOIN servicos s ON a.servico = s.nome WHERE a.id = ?', [req.params.id]);
        if(ag.length > 0 && ag[0].status !== 'Concluído') {
            await db.query('UPDATE agendamentos SET status = "Concluído" WHERE id = ?', [req.params.id]);
            await db.query('INSERT INTO transacoes (tipo, descricao, valor, data) VALUES (?, ?, ?, CURDATE())', ['Entrada', `Serviço: ${ag[0].servico} (${ag[0].cliente})`, ag[0].preco || 0]);
        }
        res.json({ message: 'Faturado!' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* =========================================
   FINANCEIRO E RELATÓRIOS
========================================= */
app.get('/api/financeiro', async (req, res) => {
    try {
        const [transacoes] = await db.query("SELECT id, tipo, descricao, valor, DATE_FORMAT(data, '%Y-%m-%d') as data FROM transacoes ORDER BY id DESC");
        const [resumo] = await db.query(`SELECT SUM(CASE WHEN tipo = 'Entrada' THEN valor ELSE 0 END) as entradas, SUM(CASE WHEN tipo = 'Saída' THEN valor ELSE 0 END) as saidas FROM transacoes`);
        res.json({ transacoes, resumo: resumo[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/financeiro', async (req, res) => { 
    try { await db.query('INSERT INTO transacoes (tipo, descricao, valor, data) VALUES (?, ?, ?, ?)', [req.body.tipo, req.body.descricao, req.body.valor, req.body.data]); res.json({ message: 'Lançado!' }); } catch (e) { res.status(500).json({ error: e.message }); } 
});

app.get('/api/relatorios/financeiro', async (req, res) => {
    try {
        const { inicio, fim } = req.query;
        let query = "SELECT id, tipo, descricao, valor, DATE_FORMAT(data, '%Y-%m-%d') as data FROM transacoes WHERE 1=1";
        let params = [];
        if (inicio) { query += " AND data >= ?"; params.push(inicio); }
        if (fim) { query += " AND data <= ?"; params.push(fim); }
        query += " ORDER BY data DESC";
        const [transacoes] = await db.query(query, params);
        let entradas = 0; let saidas = 0;
        transacoes.forEach(t => { if (t.tipo === 'Entrada') entradas += parseFloat(t.valor); else saidas += parseFloat(t.valor); });
        res.json({ transacoes, resumo: { entradas, saidas, liquido: entradas - saidas } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* =========================================
   SERVIÇOS E EQUIPE
========================================= */
app.get('/api/servicos', async (req, res) => { try { const [s] = await db.query('SELECT * FROM servicos ORDER BY nome ASC'); res.json(s); } catch(e){ res.status(500).json({ error: e.message }); } });
app.post('/api/servicos', async (req, res) => { try { await db.query('INSERT INTO servicos (nome, preco) VALUES (?, ?)', [req.body.nome, req.body.preco]); res.json({ message: 'Salvo!' }); } catch(e){ res.status(500).json({ error: e.message }); } });
app.get('/api/barbeiros', async (req, res) => { try { const [b] = await db.query('SELECT * FROM barbeiros ORDER BY nome ASC'); res.json(b); } catch(e){ res.status(500).json({ error: e.message }); } });
app.post('/api/barbeiros', async (req, res) => { try { await db.query('INSERT INTO barbeiros (nome, telefone) VALUES (?, ?)', [req.body.nome, req.body.telefone]); res.json({ message: 'Salvo!' }); } catch(e){ res.status(500).json({ error: e.message }); } });

/* =========================================
   PORTAL DO CLIENTE
========================================= */
app.post('/api/cliente/login', async (req, res) => {
    try {
        const { email, barber_id } = req.body;
        const [barbeiro] = await db.query('SELECT id, nome FROM usuarios WHERE id = ?', [barber_id]);
        if (barbeiro.length === 0) return res.status(400).json({ error: 'Código da Barbearia inválido!' });

        const [existente] = await db.query('SELECT * FROM clientes WHERE email = ?', [email]);
        let nomeCliente = email.split('@')[0];
        
        if (existente.length === 0) await db.query('INSERT INTO clientes (nome, email, telefone) VALUES (?, ?, ?)', [nomeCliente, email, '']);
        else nomeCliente = existente[0].nome;
        
        res.json({ message: 'Conectado!', user: { nome: nomeCliente, email: email, barber_id: barber_id, nomeBarbearia: barbeiro[0].nome } });
    } catch (error) { res.status(500).json({ error: 'Erro no servidor' }); }
});

app.get('/api/cliente/agendamentos', async (req, res) => {
    try {
        const { email } = req.query;
        const [cliente] = await db.query('SELECT nome FROM clientes WHERE email = ?', [email]);
        if (cliente.length === 0) return res.json([]);
        const [agendamentos] = await db.query(`SELECT id, servico, barbeiro, DATE_FORMAT(data, '%Y-%m-%d') as data, status FROM agendamentos WHERE cliente = ? ORDER BY data DESC`, [cliente[0].nome]);
        res.json(agendamentos);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cliente/agendar', async (req, res) => {
    try {
        const { email, servico, barbeiro, data } = req.body;
        const [cliente] = await db.query('SELECT nome FROM clientes WHERE email = ?', [email]);
        if (cliente.length > 0) {
            await db.query('INSERT INTO agendamentos (cliente, servico, barbeiro, data, status) VALUES (?, ?, ?, ?, ?)', [cliente[0].nome, servico, barbeiro, data, 'Pendente']);
            res.json({ message: 'Horário agendado!' });
        } else { res.status(400).json({ error: 'Cliente não encontrado' }); }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Configuração da Porta Dinâmica para o Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando com sucesso na porta ${PORT}`));
