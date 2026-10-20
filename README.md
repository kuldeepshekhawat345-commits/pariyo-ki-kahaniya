# LinkPulse

URL shortener with rules, campaigns, QR codes, CSV import and click analytics.

## Run locally
npm install
npm start        (set PORT to use another port)

Demo logins: demo / demo123 (user), admin / admin123 (admin). Sample links, campaigns and clicks are created on first start.

## Structure
server.js            API, redirect engine, rules, tracking
public/index.html    app shell
public/css/style.css design
public/js/app.js     all screens
data/db.json         created automatically (storage)

## Deploy
Render Web Service: Build "npm install", Start "npm start".
Free hosting erases data/db.json on restart, so use a persistent database for real use.
