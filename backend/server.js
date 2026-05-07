require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const http = require('http');
const app = require('./src/app');
const connectDB = require('./src/config/database');
const initSocket = require('./src/socket');

const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  const server = http.createServer(app);
  const io = initSocket(server);
  app.set('io', io);

  server.listen(PORT, () => {
    console.log(`🚀 Servidor Já! rodando na porta ${PORT}`);
  });
}).catch((err) => {
  console.error('Erro ao conectar banco de dados:', err);
  process.exit(1);
});
