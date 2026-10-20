# LinkTrack

Users shorten links and see clicks and visitors for their own links.
Admin sees all users, how many links each created, their devices, and can block or delete accounts.

## Run
npm install
npm start     (set PORT to use another port)

Admin login: username "admin". Password: the ADMIN_PASSWORD environment variable, or admin123 if not set.
Users create their own accounts on the login screen.

## Structure
server.js            API, redirect and tracking
public/index.html
public/css/style.css
public/js/app.js
data/linktrack.json  created automatically

## Deploy
Render Web Service: Build "npm install", Start "npm start". Set ADMIN_PASSWORD in the Environment tab.
Free hosting erases data/linktrack.json on restart.
