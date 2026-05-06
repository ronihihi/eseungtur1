const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const Datastore = require('nedb');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

if (!fs.existsSync('data')) fs.mkdirSync('data');
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const db = {
  users: new Datastore({ filename: 'data/users.db', autoload: true }),
  documents: new Datastore({ filename: 'data/documents.db', autoload: true }),
  recipients: new Datastore({ filename: 'data/recipients.db', autoload: true })
};

const dbFind = (col, query) => new Promise((res, rej) => db[col].find(query, (e, d) => e ? rej(e) : res(d)));
const dbFindOne = (col, query) => new Promise((res, rej) => db[col].findOne(query, (e, d) => e ? rej(e) : res(d)));
const dbInsert = (col, doc) => new Promise((res, rej) => db[col].insert(doc, (e, d) => e ? rej(e) : res(d)));
const dbUpdate = (col, query, update, opts={}) => new Promise((res, rej) => db[col].update(query, update, opts, (e, n) => e ? rej(e) : res(n)));
const dbRemove = (col, query, opts={}) => new Promise((res, rej) => db[col].remove(query, opts, (e, n) => e ? rej(e) : res(n)));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'esign-secret-change-in-production',
  resave: false, saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads'),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({
  storage, limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only PDF and Word documents are allowed'));
  }
});

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' }
});

const requireAuth = (req, res, next) => {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Please log in first' });
};

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existing = await dbFindOne('users', { email });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await dbInsert('users', { name, email, password: hashed, role: 'admin', createdAt: new Date() });
    req.session.userId = user._id;
    req.session.userName = name;
    req.session.userEmail = email;
    res.json({ success: true, user: { name, email } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await dbFindOne('users', { email });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    req.session.userId = user._id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;
    res.json({ success: true, user: { name: user.name, email: user.email } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({ user: { name: req.session.userName, email: req.session.userEmail } });
});

app.post('/api/documents', requireAuth, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { title, signing_order } = req.body;
    const doc = await dbInsert('documents', {
      _id: uuidv4(), title: title || req.file.originalname,
      filename: req.file.originalname, filepath: req.file.path,
      uploadedBy: req.session.userId, uploaderName: req.session.userName,
      signingOrder: signing_order || 'simultaneous',
      status: 'draft', createdAt: new Date()
    });
    res.json({ success: true, documentId: doc._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/documents', requireAuth, async (req, res) => {
  try {
    const docs = await dbFind('documents', { uploadedBy: req.session.userId });
    const result = await Promise.all(docs.map(async d => {
      const recipients = await dbFind('recipients', { documentId: d._id });
      return { ...d, total_recipients: recipients.length, signed_count: recipients.filter(r => r.status === 'signed').length };
    }));
    result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ documents: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const doc = await dbFindOne('documents', { _id: req.params.id, uploadedBy: req.session.userId });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const recipients = await dbFind('recipients', { documentId: req.params.id });
    recipients.sort((a, b) => a.signOrder - b.signOrder);
    res.json({ document: doc, recipients });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/documents/:id/recipients', requireAuth, async (req, res) => {
  try {
    const { recipients } = req.body;
    const doc = await dbFindOne('documents', { _id: req.params.id, uploadedBy: req.session.userId });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    await dbRemove('recipients', { documentId: req.params.id }, { multi: true });
    await Promise.all(recipients.map((r, i) =>
      dbInsert('recipients', {
        _id: uuidv4(), documentId: req.params.id,
        teamName: r.team_name, email: r.email,
        signOrder: i + 1, status: 'pending',
        token: uuidv4(), createdAt: new Date()
      })
    ));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/documents/:id/send', requireAuth, async (req, res) => {
  try {
    const { subject, message } = req.body;
    const doc = await dbFindOne('documents', { _id: req.params.id, uploadedBy: req.session.userId });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const recipients = await dbFind('recipients', { documentId: req.params.id });
    recipients.sort((a, b) => a.signOrder - b.signOrder);
    if (!recipients.length) return res.status(400).json({ error: 'No recipients added' });
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const toSend = doc.signingOrder === 'sequential' ? [recipients[0]] : recipients;
    for (const r of toSend) await sendEmail(r, doc, `${baseUrl}/sign/${r.token}`, subject, message, req.session.userName);
    await dbUpdate('documents', { _id: req.params.id }, { $set: { status: 'sent' } });
    res.json({ success: true, sent: toSend.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function sendEmail(recipient, doc, signUrl, subject, message, senderName) {
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
    <div style="background:#f8f9fa;border-radius:8px;padding:30px;margin-bottom:20px">
      <h2 style="color:#1a1a2e;margin-top:0">Document Signature Required</h2>
      <p style="color:#555;line-height:1.6">${message || 'Please review and sign the document below.'}</p>
      <div style="background:white;border:1px solid #e0e0e0;border-radius:6px;padding:16px;margin:20px 0">
        <p style="margin:0;font-size:14px;color:#888">Document</p>
        <p style="margin:4px 0 0;font-weight:bold;font-size:16px">${doc.title}</p>
      </div>
      <a href="${signUrl}" style="display:inline-block;background:#1a1a2e;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:16px;margin-top:10px">Review &amp; Sign Document →</a>
    </div>
    <p style="font-size:12px;color:#999;text-align:center">Sent by ${senderName || 'E-Sign Workflow'}<br>This link is unique to you — do not share it.</p>
    </body></html>`;
  await transporter.sendMail({
    from: `"E-Sign Workflow" <${process.env.SMTP_USER}>`,
    to: `${recipient.teamName} <${recipient.email}>`,
    subject: subject || `Action Required: Please sign "${doc.title}"`,
    html
  });
}

app.get('/sign/:token', async (req, res) => {
  const r = await dbFindOne('recipients', { token: req.params.token });
  if (!r) return res.status(404).send('<h2>Invalid or expired signing link.</h2>');
  if (r.status === 'signed') return res.send(`<html><body style="font-family:Arial;text-align:center;padding:60px"><h2 style="color:#1D9E75">✓ Already Signed</h2><p>Thank you! You have already signed this document.</p></body></html>`);
  await dbUpdate('recipients', { token: req.params.token }, { $set: { status: 'viewed', viewedAt: new Date() } });
  res.sendFile(path.join(__dirname, 'public', 'sign.html'));
});

app.get('/api/sign/:token', async (req, res) => {
  try {
    const r = await dbFindOne('recipients', { token: req.params.token });
    if (!r) return res.status(404).json({ error: 'Invalid link' });
    const doc = await dbFindOne('documents', { _id: r.documentId });
    res.json({ recipient: { ...r, title: doc?.title } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sign/:token', async (req, res) => {
  try {
    const { full_name } = req.body;
    const r = await dbFindOne('recipients', { token: req.params.token });
    if (!r) return res.status(404).json({ error: 'Invalid link' });
    if (r.status === 'signed') return res.status(400).json({ error: 'Already signed' });
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    await dbUpdate('recipients', { token: req.params.token }, { $set: { status: 'signed', signedAt: new Date(), signerName: full_name, ipAddress: ip } });
    const doc = await dbFindOne('documents', { _id: r.documentId });
    if (doc?.signingOrder === 'sequential') {
      const all = await dbFind('recipients', { documentId: r.documentId });
      all.sort((a, b) => a.signOrder - b.signOrder);
      const next = all.find(x => x.signOrder === r.signOrder + 1 && x.status === 'pending');
      if (next) {
        const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        await sendEmail(next, doc, `${baseUrl}/sign/${next.token}`, null, null, 'E-Sign Workflow');
      }
    }
    const allR = await dbFind('recipients', { documentId: r.documentId });
    if (allR.every(x => x.status === 'signed')) {
      await dbUpdate('documents', { _id: r.documentId }, { $set: { status: 'completed', completedAt: new Date() } });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/documents/:id/status', requireAuth, async (req, res) => {
  try {
    const recipients = await dbFind('recipients', { documentId: req.params.id });
    recipients.sort((a, b) => a.signOrder - b.signOrder);
    const doc = await dbFindOne('documents', { _id: req.params.id });
    res.json({ recipients, status: doc?.status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/recipients/:id/remind', requireAuth, async (req, res) => {
  try {
    const r = await dbFindOne('recipients', { _id: req.params.id });
    if (!r) return res.status(404).json({ error: 'Recipient not found' });
    const doc = await dbFindOne('documents', { _id: r.documentId });
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    await sendEmail(r, doc, `${baseUrl}/sign/${r.token}`,
      `Reminder: Please sign "${doc.title}"`,
      'This is a friendly reminder to sign the document at your earliest convenience.',
      req.session.userName
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`\n✅ E-Sign Workflow running at http://localhost:${PORT}`);
  console.log(`📧 Add SMTP_USER + SMTP_PASS in Replit Secrets to enable emails\n`);
});
