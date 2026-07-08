"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { EventEmitter } = require('events');
const changeBus = new EventEmitter();
changeBus.setMaxListeners(200);
/*
 * GET /api/events — SSE endpoint for real-time change notifications.
 * Streams a change event whenever the 30-min poll detects significant
 * model changes (large benchmark diffs, price shifts).
 *
 * Event format:
 *   data: {"type":"change","models":[...],"timestamp":"..."}
 */
function register(app) {
    app.get('/api/events', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.write('data: {"type":"connected"}\n\n');
        function onChanges(changes) {
            if (res.closed)
                return;
            res.write('data: ' + JSON.stringify({ type: 'change', count: changes.length, changes, timestamp: new Date().toISOString() }) + '\n\n');
        }
        changeBus.on('changes', onChanges);
        const keepalive = setInterval(() => {
            if (res.closed) {
                clearInterval(keepalive);
                return;
            }
            res.write(':keepalive\n\n');
        }, 15000);
        req.on('close', () => {
            clearInterval(keepalive);
            changeBus.off('changes', onChanges);
        });
    });
}
module.exports = { register, changeBus };
//# sourceMappingURL=events.js.map