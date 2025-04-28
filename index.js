require('dotenv').config();
const express = require('express');
const Redis = require('ioredis');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const redis = new Redis(process.env.REDIS_URL);

// 사용자 정보 저장 API
app.post('/login', async (req, res) => {
  try {
    const {id, position, hair, dress} = req.body

    if (!id) {
      res.status(400).json({error: '사용자 정보가 없어요'})
      return
    }
    await redis.lpush('chat:login', JSON.stringify({id, position, hair, dress}))
    res.json({status: 'ok'})

  } catch (e) {
    res.status(500).json({error: e?.message ?? '알 수 없는 에러가 발생했어요'})
  }
})

// 단순 메시지 저장 API
app.post('/message', async (req, res) => {
  const {user, message} = req.body;
  await redis.lpush('chat:messages', JSON.stringify({user, message}));
  res.send({status: 'ok'});
});

// 최근 메시지 10개 가져오기
app.get('/messages', async (req, res) => {
  const messages = await redis.lrange('chat:messages', 0, 9);
  res.send(messages.map((msg) => JSON.parse(msg)));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
