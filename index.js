require('dotenv').config();
const express = require('express');
const Redis = require('ioredis');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({server});

app.use(cors());
app.use(express.json());

const redis = new Redis(process.env.REDIS_URL);

const USER_POSITION_KEY = 'chat:user_positions';

// 사용자 정보 저장 (로그인 시)
app.post('/login', async (req, res) => {
  try {
    const bodyData = req.body;

    console.log(bodyData.id)

    if (!bodyData.id) {
      return res.status(400).json({error: '사용자 정보가 없어요'});
    }

    const userData = {
      id: bodyData.id,
      position: {x: bodyData.position},
      hair: bodyData.hair,
      dress: bodyData.dress
    };

    redis.hset(USER_POSITION_KEY, bodyData.id, JSON.stringify(userData));

    const allFields = await redis.hkeys(USER_POSITION_KEY)
    console.log('[Redis에 저장된 필드 목록]', allFields)

    res.json({status: 'ok'});
  } catch (e) {
    res.status(500).json({error: e?.message ?? '알 수 없는 에러가 발생했어요'});
  }
});

// 메시지 저장
app.post('/message', async (req, res) => {
  const {user, message} = req.body;
  await redis.lpush('chat:messages', JSON.stringify({user, message}));
  res.send({status: 'ok'});
});

// 최근 메시지 10개
app.get('/messages', async (req, res) => {
  const messages = await redis.lrange('chat:messages', 0, 9);
  res.send(messages.map((msg) => JSON.parse(msg)));
});

// 채팅방 전체 초기화
app.post('/reset', async (req, res) => {
  try {
    await redis.del(USER_POSITION_KEY)
    await redis.del('chat:messages')
    broadcast({type: 'update-positions', payload: []})
    res.json({status: 'reset ok'})
  } catch (e) {
    res.status(500).json({error: e.message})
  }
})

// 모든 사용자 삭제
app.post('/clear-users', async (req, res) => {
  try {
    await redis.del(USER_POSITION_KEY)
    broadcast({type: 'update-positions', payload: []})
    res.json({status: '모든 사용자 삭제 완료'})
  } catch (e) {
    res.status(500).json({error: e.message})
  }
})

// 사용자 삭제
app.post('/delete-user', async (req, res) => {
  try {
    const {userId} = req.body

    console.log('[삭제 시도할 userId]', userId, typeof userId)
    await redis.hdel(USER_POSITION_KEY, userId);
    const remaining = await redis.hgetall(USER_POSITION_KEY);
    broadcast({
      type: 'update-positions',
      payload: Object.values(remaining).map(JSON.parse),
    });
    res.json({status: '사용자 삭제 완료'});
  } catch (e) {
    res.status(500).json({error: e.message})
  }
})

// WebSocket 연결 관리
wss.on('connection', async (ws, req) => {
  const {searchParams} = new URL(req.url, `http://${req.headers.host}`);
  const userId = searchParams.get('userId');

  console.log('wss connection', userId)

  try {
    const existing = await redis.hget(USER_POSITION_KEY, userId);

    console.log(existing)

    if (!existing) {
      throw new Error('사용자 정보가 없습니다');
    }

    // 최초 전체 사용자 정보 전송
    const allUsers = await redis.hgetall(USER_POSITION_KEY);
    const parsedUsers = Object.values(allUsers).map(JSON.parse);
    broadcast({type: 'update-positions', payload: parsedUsers});
  } catch (e) {
    console.error('에러 발생:', e);
    ws.send(JSON.stringify({type: 'error', message: '사용자 정보가 없습니다'}));
  }

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);
      console.log(data.type, data.payload)

      if (data.type === 'move') {
        const {id, x} = data.payload;
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

      } else if (data.type === 'kick') {
        const {id} = data.payload;
        await redis.hdel(USER_POSITION_KEY, id);

        const remaining = await redis.hgetall(USER_POSITION_KEY);
        broadcast({
          type: 'update-positions',
          payload: Object.values(remaining).map(JSON.parse),
        });
      } else if (data.type === 'chat') {
        const {id, message} = data.payload
        const uniqueChatId = `${new Date().getTime()}_${Math.floor(
            Math.random() * 1000000)}`
        if (typeof id === 'string' && typeof message === 'string'
            && message.length <= 30) {
          broadcast({
            type: 'chat',
            payload: {
              id: uniqueChatId,
              userId: id,
              message,
              createdAt: Date.now()
            },
          });
        }
      }

    } catch (e) {
      console.error('에러 발생:', e);
      ws.send(JSON.stringify({type: 'error', message: '서버 처리 중 오류가 발생했습니다.'}));
    }
  });

  ws.on('close', async () => {
    await redis.hdel(USER_POSITION_KEY, userId);
    const remaining = await redis.hgetall(USER_POSITION_KEY);
    broadcast({
      type: 'update-positions',
      payload: Object.values(remaining).map(JSON.parse)
    });
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
