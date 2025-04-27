require('dotenv').config();
const express = require('express');
const Redis = require('ioredis');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const redis = new Redis(process.env.REDIS_URL);

// 단순 메시지 저장 API
app.post('/message', async (req, res) => {
    const { user, message } = req.body;
    await redis.lpush('chat:messages', JSON.stringify({ user, message }));
    res.send({ status: 'ok' });
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
