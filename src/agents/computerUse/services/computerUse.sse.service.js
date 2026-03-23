export function initSSE(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
}

export function sendSSE(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function sendScreenshot(res, page) {
    try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
        sendSSE(res, 'screenshot', { data: buf.toString('base64') });
    } catch {
        // Screenshot failures should not interrupt execution.
    }
}
