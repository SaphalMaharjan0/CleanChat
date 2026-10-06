import express from 'express';

export function startServer(client, { getRaidMode = () => false } = {}) {
    const app = express();
    const port = process.env.PORT || 3000;

    app.use(express.json());

    // Simple liveness check (useful for uptime monitors / hosting platforms)
    app.get('/health', (req, res) => {
        res.json({ ok: true });
    });

    // Bot status
    app.get('/api/status', (req, res) => {
        res.json({
            ready: client.isReady(),
            tag: client.user?.tag ?? null,
            ping: client.ws.ping,
            uptimeSeconds: Math.floor(process.uptime()),
            guilds: client.guilds.cache.size,
            raidMode: getRaidMode(),
        });
    });

    app.use((req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    app.use((err, req, res, next) => {
        console.error('[Express Error]', err);
        res.status(500).json({ error: 'Internal server error' });
    });

    return app.listen(port, () => {
        console.log(`[Express] Server listening on port ${port}`);
    });
}
