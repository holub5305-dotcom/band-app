"""Testovací server pro regresi 1p: jako GitHub Pages PO uplynutí max-age (nové nasazení = nové validátory).
Ignoruje If-Modified-Since (python http.server jinak vrací 304 podle mtime, což u starších souborů nesimuluje nové nasazení)."""
import http.server, sys
class H(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        if 'If-Modified-Since' in self.headers: del self.headers['If-Modified-Since']
        return super().send_head()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
