"""Místní NÁHRADA služby TURN (Cloudflare Workeru) jen pro automatické testy 1.3.0 – běží na localhost.
Vrací stejný tvar odpovědi jako _tools/turn-worker (režim static): { iceServers, ttl, mode }.
Testovací jméno/heslo k MÍSTNÍMU coturnu dostane z proměnných prostředí (náhodné při každém běhu, nic skutečného).
Režim přepíná test: GET /_mode?m=ok|503|500|slow. Záznam žádostí: GET /_log (jen room + uid z tokenu emulátoru)."""
import base64, http.server, json, os, sys, threading, time
PORT = int(sys.argv[1]); ORIGIN = 'http://localhost:8793'
USER, PASS, TURN = os.environ['MOCK_TURN_USER'], os.environ['MOCK_TURN_PASS'], os.environ.get('MOCK_TURN_HOST', '127.0.0.1:3478')
STATE = {'m': 'ok'}; LOG = []
def uid_of(auth):
    try:
        p = auth.split(' ', 1)[1].split('.')[1]; p += '=' * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get('user_id', '')
    except Exception: return ''
class H(http.server.BaseHTTPRequestHandler):
    def _h(self, code, body=b'', ctype='application/json'):
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', ORIGIN); self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS'); self.send_header('Access-Control-Allow-Headers', 'Authorization')
        self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self): self._h(204)
    def do_GET(self):
        path, _, q = self.path.partition('?'); qs = dict(x.split('=', 1) for x in q.split('&') if '=' in x)
        if path == '/_mode': STATE['m'] = qs.get('m', 'ok'); return self._h(200, b'{}')
        if path == '/_log': return self._h(200, json.dumps(LOG).encode())
        if path != '/ice': return self._h(404, b'{}')
        auth = self.headers.get('Authorization', '')
        LOG.append({'t': time.time(), 'room': qs.get('room', ''), 'uid': uid_of(auth), 'bearer': auth.startswith('Bearer '), 'mode': STATE['m']})
        if not auth.startswith('Bearer '): return self._h(401, b'{"error":"auth"}')
        m = STATE['m']
        if m == '503': return self._h(503, json.dumps({'error': 'not_configured', 'message': 'TURN není nastaven'}).encode())
        if m == '500': return self._h(500, b'{"error":"config"}')
        if m == 'slow': time.sleep(8)
        body = {'iceServers': [{'urls': ['stun:' + TURN]}, {'urls': ['turn:%s?transport=udp' % TURN, 'turn:%s?transport=tcp' % TURN], 'username': USER, 'credential': PASS}], 'ttl': 14400, 'mode': 'static'}
        self._h(200, json.dumps(body).encode())
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
