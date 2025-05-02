require('dotenv').config();
const express = require('express');
const Redis = require('ioredis');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const redis = new Redis(process.env.REDIS_URL);

const USER_POSITION_KEY = 'chat:user_positions';

// 사용자 정보 저장 (로그인 시)
app.post('/login', async (req, res) => {
  try {
    const { id, position, hair, dress } = req.body;

    if (!id) {
      return res.status(400).json({ error: '사용자 정보가 없어요' });
    }

    const userData = { id, position, hair, dress };
    await redis.hset(USER_POSITION_KEY, id, JSON.stringify(userData));

    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: e?.message ?? '알 수 없는 에러가 발생했어요' });
  }
});

// 메시지 저장
app.post('/message', async (req, res) => {
  const { user, message } = req.body;
  await redis.lpush('chat:messages', JSON.stringify({ user, message }));
  res.send({ status: 'ok' });
});

// 최근 메시지 10개
app.get('/messages', async (req, res) => {
  const messages = await redis.lrange('chat:messages', 0, 9);
  res.send(messages.map((msg) => JSON.parse(msg)));
});

// WebSocket 연결 관리
wss.on('connection', async (ws) => {
  const userId = `${Math.floor(1000 + Math.random() * 9000)}`;
  const defaultUser = {
    id: userId,
    position: { x: 0 },
    hair: 'black',
    dress: 'white',
  };

  await redis.hset(USER_POSITION_KEY, userId, JSON.stringify(defaultUser));
  ws.send(JSON.stringify({ type: 'assign-id', payload: { id: userId } }));

  // 최초 전체 사용자 정보 전송
  const allUsers = await redis.hgetall(USER_POSITION_KEY);
  const parsedUsers = Object.values(allUsers).map(JSON.parse);
  broadcast({ type: 'update-positions', payload: parsedUsers });

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'move') {
        const { id, x } = data.payload;
        const raw = await redis.hget(USER_POSITION_KEY, id);
        if (raw) {
          const user = JSON.parse(raw);
          user.position.x = x;
          await redis.hset(USER_POSITION_KEY, id, JSON.stringify(user));
        }

        const all = await redis.hgetall(USER_POSITION_KEY);
        broadcast({
          type: 'update-positions',
          payload: Object.values(all).map(JSON.parse),
        });
      }
    } catch (e) {
      console.error('에러 발생:', e);
      ws.send(JSON.stringify({ type: 'error', message: '서버 처리 중 오류가 발생했습니다.' }));
    }
  });

  ws.on('close', async () => {
    await redis.hdel(USER_POSITION_KEY, userId);
    const remaining = await redis.hgetall(USER_POSITION_KEY);
    broadcast({ type: 'update-positions', payload: Object.values(remaining).map(JSON.parse) });
  });
});

// 전체 사용자에게 메시지 전송
function broadcast(data) {
  const json = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
