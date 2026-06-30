import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'farhan1625';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@skhenna.com').toLowerCase();

// Middleware
app.use(cors());
app.use(express.json());

// ──────────────────────────────────────────────
// IN-MEMORY DATA STORE (works without MongoDB)
// ──────────────────────────────────────────────
let bookings = [];
let orders = [];
let users = [];
const otpSessions = new Map(); // email -> { otp, expiresAt }

let dbConnected = false;

// Try to connect to MongoDB optionally
let Booking, Order, User, OtpSession;

async function tryConnectDB() {
  try {
    const { default: mongoose } = await import('mongoose');
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skhenna';
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });

    // Define models only if connected
    const BookingSchema = new mongoose.Schema({
      clientName: { type: String, required: true },
      phone: { type: String, required: true },
      date: { type: String, required: true },
      time: { type: String, required: true },
      occasion: { type: String, default: 'Custom' },
      handDetails: { type: String, default: 'Standard' },
      address: { type: String, required: true },
      notes: String,
      status: { type: String, default: 'pending', enum: ['pending', 'confirmed', 'completed', 'cancelled'] }
    }, { timestamps: true });

    const OrderSchema = new mongoose.Schema({
      customerName: { type: String, required: true },
      phone: { type: String, required: true },
      nailConesQty: { type: Number, default: 0 },
      normalConesQty: { type: Number, default: 0 },
      bridalConesQty: { type: Number, default: 0 },
      totalPrice: { type: Number, required: true, default: 0 },
      address: { type: String, required: true },
      status: { type: String, default: 'pending', enum: ['pending', 'shipped', 'completed', 'cancelled'] }
    }, { timestamps: true });

    const UserSchema = new mongoose.Schema({
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      verified: { type: Boolean, default: true }
    }, { timestamps: true });

    Booking = mongoose.model('Booking', BookingSchema);
    Order = mongoose.model('Order', OrderSchema);
    User = mongoose.model('User', UserSchema);
    dbConnected = true;
    console.log('✅ MongoDB connected successfully!');
  } catch (err) {
    console.log('⚠️  MongoDB not available - using in-memory storage (data resets on server restart)');
    dbConnected = false;
  }
}

tryConnectDB();

// ──────────────────────────────────────────────
// Pricing Config
// ──────────────────────────────────────────────
const CONE_PRICES = {
  nailCone: 20,
  normalCone: 20,
  bridalCone: 40
};

// ──────────────────────────────────────────────
// Admin Auth Middleware
// ──────────────────────────────────────────────
const adminAuth = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ message: 'No authorization token provided' });
  const password = token.replace('Bearer ', '');
  if (password === ADMIN_PASSWORD) {
    next();
  } else {
    res.status(403).json({ message: 'Invalid admin password' });
  }
};

// Helper to generate a simple ID for in-memory objects
const genId = () => crypto.randomBytes(12).toString('hex');

// ──────────────────────────────────────────────
// PUBLIC ENDPOINTS
// ──────────────────────────────────────────────

// Config
app.get('/api/config', (req, res) => {
  res.json({
    whatsappNumber: process.env.WHATSAPP_NUMBER || '918149814003',
    instagramId: '@Henna_by_shifa25',
    instagramUrl: 'https://www.instagram.com/Henna_by_shifa25',
    prices: CONE_PRICES,
    googleClientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});

// Create booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { clientName, phone, date, time, occasion, handDetails, address, notes } = req.body;
    if (!clientName || !phone || !date || !time || !address) {
      return res.status(400).json({ message: 'Please provide all required fields (Name, Phone, Date, Time, Address).' });
    }

    if (dbConnected && Booking) {
      const booking = await Booking.create({ clientName, phone, date, time, occasion, handDetails, address, notes, status: 'pending' });
      return res.status(201).json({ message: 'Booking created successfully!', booking });
    } else {
      // In-memory fallback
      const booking = { _id: genId(), id: genId(), clientName, phone, date, time, occasion: occasion || 'Custom', handDetails: handDetails || 'Standard', address, notes, status: 'pending', createdAt: new Date().toISOString() };
      bookings.unshift(booking);
      return res.status(201).json({ message: 'Booking created successfully!', booking });
    }
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ message: 'Server error. Failed to create booking.' });
  }
});

// Create bulk order
app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, phone, nailConesQty, normalConesQty, bridalConesQty, address } = req.body;
    if (!customerName || !phone || !address) {
      return res.status(400).json({ message: 'Please provide customer name, phone, and delivery address.' });
    }

    const nailQty = parseInt(nailConesQty) || 0;
    const normalQty = parseInt(normalConesQty) || 0;
    const bridalQty = parseInt(bridalConesQty) || 0;

    if (nailQty <= 0 && normalQty <= 0 && bridalQty <= 0) {
      return res.status(400).json({ message: 'Order must contain at least 1 cone.' });
    }

    const totalPrice = (nailQty * CONE_PRICES.nailCone) + (normalQty * CONE_PRICES.normalCone) + (bridalQty * CONE_PRICES.bridalCone);

    let createdOrder;
    if (dbConnected && Order) {
      createdOrder = await Order.create({ customerName, phone, nailConesQty: nailQty, normalConesQty: normalQty, bridalConesQty: bridalQty, totalPrice, address, status: 'pending' });
    } else {
      createdOrder = { _id: genId(), id: genId(), customerName, phone, nailConesQty: nailQty, normalConesQty: normalQty, bridalConesQty: bridalQty, totalPrice, address, status: 'pending', createdAt: new Date().toISOString() };
      orders.unshift(createdOrder);
    }

    // Send email to ADMIN asynchronously (don't block the HTTP response)
    const orderId = createdOrder.id || createdOrder._id;
    const orderEmailHtml = `
      <div style="font-family: Georgia, serif; max-width: 550px; margin: 0 auto; background: #fff7f0; padding: 32px; border-radius: 16px; border: 1px solid #fbcfe8;">
        <h1 style="color: #ec4899; font-size: 24px; margin-bottom: 4px;">🛍️ New Order Received!</h1>
        <p style="color: #9d174d; font-size: 14px; margin-top: 0;">SK Henna Store Notification</p>
        <hr style="border: none; border-top: 1px solid #fce7f3; margin: 20px 0;" />
        
        <h3 style="color: #9d174d; margin-top: 0;">Order Details</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px; width: 120px;"><strong>Order ID:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px;">#${orderId}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px;"><strong>Customer:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px;">${customerName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px;"><strong>Phone:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px;">${phone}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px;"><strong>Address:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px;">${address}</td>
          </tr>
        </table>
        
        <h3 style="color: #9d174d;">Items Ordered</h3>
        <div style="background: white; border-radius: 8px; padding: 16px; margin-bottom: 20px; border: 1px solid #fbcfe8;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <th style="text-align: left; padding: 8px 0; color: #4b5563; font-size: 14px;">Item</th>
                <th style="text-align: right; padding: 8px 0; color: #4b5563; font-size: 14px;">Qty</th>
              </tr>
            </thead>
            <tbody>
              ${nailQty > 0 ? `
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #374151; font-size: 14px;">Nail Cone</td>
                <td style="text-align: right; padding: 8px 0; color: #374151; font-size: 14px;">${nailQty}</td>
              </tr>` : ''}
              ${normalQty > 0 ? `
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #374151; font-size: 14px;">Normal Cone</td>
                <td style="text-align: right; padding: 8px 0; color: #374151; font-size: 14px;">${normalQty}</td>
              </tr>` : ''}
              ${bridalQty > 0 ? `
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #374151; font-size: 14px;">Bridal Cone</td>
                <td style="text-align: right; padding: 8px 0; color: #374151; font-size: 14px;">${bridalQty}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 12px 0 0 0; color: #111827; font-size: 16px; font-weight: bold;"><strong>Total Price:</strong></td>
                <td style="text-align: right; padding: 12px 0 0 0; color: #ec4899; font-size: 18px; font-weight: bold;"><strong>₹${totalPrice}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    sendNotificationEmail(ADMIN_EMAIL, `🛍️ New Order Received: #${orderId}`, orderEmailHtml)
      .then(() => console.log(`📧 Order email notification sent to admin: ${ADMIN_EMAIL}`))
      .catch(err => console.error('⚠️ Failed to send order email notification to admin:', err.message));

    return res.status(201).json({ message: 'Order created successfully!', order: createdOrder });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ message: 'Server error. Failed to place order.' });
  }
});

// ──────────────────────────────────────────────
// OTP Registration
// ──────────────────────────────────────────────

// Helper: Send email via Gmail REST API (bypasses SMTP auth issues)
async function sendViaGmailAPI(to, subject, htmlBody) {
  const { OAuth2Client } = await import('google-auth-library');
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken || refreshToken === 'paste_your_refresh_token_here') {
    throw new Error('Gmail OAuth2 not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in .env');
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  // Get fresh access token
  const { token: accessToken } = await oauth2Client.getAccessToken();

  // Build raw RFC 2822 email
  const emailLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    htmlBody
  ];
  const rawEmail = Buffer.from(emailLines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Send via Gmail REST API (uses "me" — sends as whoever owns the token)
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawEmail })
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(errData.error?.message || `Gmail API error: ${response.status}`);
  }

  return await response.json();
}

// Legacy App Password transporter (Option A)
const createAppPasswordTransporter = () => {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass || pass === 'your_app_password_here') return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
};

// Unified helper to send email notifications via either App Password or Gmail REST API
async function sendNotificationEmail(to, subject, htmlBody) {
  const appPwdTransporter = createAppPasswordTransporter();
  if (appPwdTransporter) {
    await appPwdTransporter.sendMail({
      from: `"SK Henna 🌿" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: htmlBody
    });
    return;
  }

  // Fallback: Use Gmail REST API (OAuth2)
  await sendViaGmailAPI(to, subject, htmlBody);
}

app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }
  if (email.toLowerCase() === ADMIN_EMAIL) {
    return res.status(400).json({ success: false, message: 'This email is reserved for admin.' });
  }

  try {
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    otpSessions.set(email.toLowerCase(), { otp, expiresAt });

    const otpHtml = `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; background: #fff7f0; padding: 32px; border-radius: 16px;">
        <h1 style="color: #ec4899; font-size: 26px; margin-bottom: 4px;">SK_Henna ✦</h1>
        <p style="color: #9d174d; font-size: 13px; margin-top: 0;">@Henna_by_shifa25</p>
        <hr style="border: none; border-top: 1px solid #fce7f3; margin: 20px 0;" />
        <p style="color: #374151; font-size: 15px;">Your one-time verification code is:</p>
        <div style="background: linear-gradient(135deg, #f59e0b, #ec4899); border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
          <span style="font-size: 40px; font-weight: 900; color: white; letter-spacing: 10px;">${otp}</span>
        </div>
        <p style="color: #6b7280; font-size: 13px;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">If you didn't request this, please ignore this email.</p>
      </div>
    `;

    await sendNotificationEmail(email, 'Your OTP Code — SK Henna', otpHtml);
    console.log(`📧 OTP email sent to ${email}`);
    res.json({ success: true, message: `OTP sent to ${email}. Please check your inbox.` });
  } catch (err) {
    console.error('OTP send error:', err);
    res.status(500).json({
      success: false,
      message: `Failed to send email: ${err.message || 'Server error'}`
    });
  }
});


app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
  }

  try {
    const session = otpSessions.get(email.toLowerCase());
    if (!session) {
      return res.status(400).json({ success: false, message: 'OTP expired or not found. Please request a new one.' });
    }
    if (new Date() > session.expiresAt) {
      otpSessions.delete(email.toLowerCase());
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }
    if (session.otp !== otp.toString()) {
      return res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });
    }

    otpSessions.delete(email.toLowerCase());

    // Register or login user
    if (dbConnected && User) {
      let user = await User.findOne({ email: email.toLowerCase() });
      if (!user) user = await User.create({ email: email.toLowerCase() });
    } else {
      const existing = users.find(u => u.email === email.toLowerCase());
      if (!existing) users.push({ id: genId(), email: email.toLowerCase(), createdAt: new Date().toISOString() });
    }

    const token = Buffer.from(email.toLowerCase()).toString('base64');
    res.json({ success: true, role: 'user', token, message: 'Email verified! You are now logged in.' });
  } catch (err) {
    console.error('OTP verify error:', err);
    res.status(500).json({ success: false, message: 'Verification failed. Try again.' });
  }
});

// ──────────────────────────────────────────────
// Check role by email (used by frontend to decide flow)
// ──────────────────────────────────────────────

app.post('/api/auth/check-role', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

  if (email.toLowerCase() === ADMIN_EMAIL) {
    return res.json({ success: true, role: 'admin' });
  }
  return res.json({ success: true, role: 'user' });
});

// ──────────────────────────────────────────────
// Google Sign-In Login / Register
// ──────────────────────────────────────────────

app.post('/api/auth/google-login', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

  try {
    const isGoogleAdmin = email.toLowerCase() === ADMIN_EMAIL;
    const role = isGoogleAdmin ? 'admin' : 'user';
    const token = isGoogleAdmin ? ADMIN_PASSWORD : Buffer.from(email.toLowerCase()).toString('base64');

    if (!isGoogleAdmin) {
      if (dbConnected && User) {
        let user = await User.findOne({ email: email.toLowerCase() });
        if (!user) user = await User.create({ email: email.toLowerCase(), verified: true });
      } else {
        const existing = users.find(u => u.email === email.toLowerCase());
        if (!existing) users.push({ id: genId(), email: email.toLowerCase(), createdAt: new Date().toISOString() });
      }
    }

    res.json({
      success: true,
      role,
      token,
      message: isGoogleAdmin ? 'Welcome back, Admin! (Logged in via Google)' : 'Successfully logged in with Google!'
    });
  } catch (err) {
    console.error('Google login backend error:', err);
    res.status(500).json({ success: false, message: 'Server error during Google login.' });
  }
});

// ──────────────────────────────────────────────
// Admin Login (password-based)
// ──────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Please enter both email and password.' });
  }

  // Admin check — accepts the configured admin email OR 'admin' shorthand
  if ((email.toLowerCase() === ADMIN_EMAIL || email === 'admin') && password === ADMIN_PASSWORD) {
    return res.json({ success: true, role: 'admin', token: ADMIN_PASSWORD });
  }

  res.status(401).json({ success: false, message: 'Invalid email or password.' });
});


// ──────────────────────────────────────────────
// PROTECTED ADMIN ENDPOINTS
// ──────────────────────────────────────────────

app.get('/api/admin/bookings', adminAuth, async (req, res) => {
  try {
    if (dbConnected && Booking) {
      const data = await Booking.find().sort({ createdAt: -1 });
      return res.json(data);
    }
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch bookings.' });
  }
});

app.get('/api/admin/orders', adminAuth, async (req, res) => {
  try {
    if (dbConnected && Order) {
      const data = await Order.find().sort({ createdAt: -1 });
      return res.json(data);
    }
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch orders.' });
  }
});

app.put('/api/admin/bookings/:id', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (dbConnected && Booking) {
      const booking = await Booking.findById(req.params.id);
      if (!booking) return res.status(404).json({ message: 'Booking not found.' });
      booking.status = status;
      await booking.save();
      return res.json({ message: 'Booking status updated successfully.', booking });
    }
    const booking = bookings.find(b => b._id === req.params.id || b.id === req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found.' });
    booking.status = status;
    res.json({ message: 'Booking status updated successfully.', booking });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update booking status.' });
  }
});

app.put('/api/admin/orders/:id', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (dbConnected && Order) {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: 'Order not found.' });
      order.status = status;
      await order.save();
      return res.json({ message: 'Order status updated successfully.', order });
    }
    const order = orders.find(o => o._id === req.params.id || o.id === req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    order.status = status;
    res.json({ message: 'Order status updated successfully.', order });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update order status.' });
  }
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    let allBookings, allOrders;
    if (dbConnected && Booking && Order) {
      allBookings = await Booking.find();
      allOrders = await Order.find();
    } else {
      allBookings = bookings;
      allOrders = orders;
    }

    const totalSales = allOrders
      .filter(o => o.status !== 'cancelled')
      .reduce((sum, o) => sum + o.totalPrice, 0);

    const conesSold = allOrders
      .filter(o => o.status !== 'cancelled')
      .reduce((totals, o) => {
        totals.nailCones += (o.nailConesQty || 0);
        totals.normalCones += (o.normalConesQty || 0);
        totals.bridalCones += (o.bridalConesQty || 0);
        return totals;
      }, { nailCones: 0, normalCones: 0, bridalCones: 0 });

    res.json({
      totals: {
        bookingsCount: allBookings.length,
        pendingBookings: allBookings.filter(b => b.status === 'pending').length,
        ordersCount: allOrders.length,
        pendingOrders: allOrders.filter(o => o.status === 'pending').length,
        sales: totalSales
      },
      conesSold
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch statistics.' });
  }
});

// ──────────────────────────────────────────────
// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});


