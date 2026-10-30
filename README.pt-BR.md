# machado93

Clona todas as páginas de qualquer site que você indicar e hospeda a cópia no seu computador ou na sua VPS, para você ver como ficou.

*English: [README.md](README.md).*

## Motores

| Você precisa de | Motor | Inspirado em |
|---|---|---|
| Uma **pasta hospedável** de um site moderno que usa JavaScript (padrão) | `browser` (embutido) | website-scraper-puppeteer, Browsertrix |
| Espelho rápido de site clássico | `httrack` (opcional) | HTTrack |
| **Um .html autocontido** por página | `singlefile` (opcional) | SingleFile |
| **Arquivo WARC/WACZ** para preservação | `browsertrix` (opcional, Docker) | Browsertrix Crawler |

> **robots.txt** não é obedecido por padrão. Use `--respect-robots` para os motores `browser` e `httrack` o obedecerem (o `singlefile` nunca o lê).

## Uso rápido

```bash
npm install                       # Node >= 20; precisa de Brave, Chrome ou Chromium
node bin/machado93.js doctor     # confere navegador e motores opcionais

node bin/machado93.js clone https://seu-site.com --max-pages 100
node bin/machado93.js serve clones/seu-site.com-...    # http://127.0.0.1:8080
node bin/machado93.js report clones/seu-site.com-...   # REPORT.md
```

Vários motores de uma vez: `--engines browser,httrack,singlefile`.

## Na VPS

```bash
node bin/machado93.js serve /srv/clones/current --host 127.0.0.1 --port 8080 --auth usuario:senha-forte
```

Coloque Caddy ou nginx na frente para ter HTTPS (exemplos em [`deploy/`](deploy)). O servidor recusa abrir para a internet sem senha e envia `noindex`.

## Aviso legal

Direitos autorais e os termos de uso de cada site são responsabilidade sua.

## Limitações da v0.1

Páginas atrás de login ainda não são suportadas. Com `--scripts strip` (padrão) os menus e carrosséis ficam congelados no estado renderizado; com `--scripts keep` o JavaScript original continua chamando as APIs originais.

## Licença

MIT. Créditos e licenças de terceiros em [NOTICE.md](NOTICE.md).
