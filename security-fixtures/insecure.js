// demo: command injection pattern for CodeQL
const express = require('express');
const { exec } = require('child_process');
const app = express();

app.get('/ping', (req, res) => {
  const host = req.query.host;             // untrusted user input
  exec('ping -c 1 ' + host, (err, out) => { // vulnerable: command injection
    if (err) return res.status(500).send(String(err));
    res.send(out);
  });
});


app.listen(3000);
