import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Ensure data and uploads directories exist
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Initialize config flat-file
const configPath = path.join(dataDir, 'config.json');
const defaultConfig = {
  whatsappNumber: process.env.WHATSAPP_NUMBER || '918149814003',
  whatsappNumber2: process.env.WHATSAPP_NUMBER2 || '919309463714',
  instagramId: '@Henna_by_shifa25',
  instagramUrl: 'https://www.instagram.com/Henna_by_shifa25',
  instagramId2: '@sahla_hennartist',
  instagramUrl2: 'https://www.instagram.com/sahla_hennartist',
  prices: {
    siderCone: 20,
    bridalCone: 40
  }
};
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
}

// Initialize gallery flat-file
const galleryPath = path.join(dataDir, 'gallery.json');
const defaultGallery = [
  {
    id: "1",
    title: 'Detailed Bridal Henna',
    category: 'bridal',
    img: '/henna_hands.png',
    likes: 142,
    description: 'Intricate floral and geometric patterns covering full hands and wrists, stained to a mahogany color.'
  },
  {
    id: "2",
    title: 'Organic Henna Cones Pack',
    category: 'cones',
    img: '/henna_cones.png',
    likes: 98,
    description: 'Handcrafted fresh organic henna cones packaged and ready for bridal application.'
  },
  {
    id: "3",
    title: 'Mehndi Mandalas',
    category: 'bridal',
    img: '/henna_hands.png',
    likes: 83,
    description: 'Elegant mandala design in the center of the palm with detailed finger detailing.'
  },
  {
    id: "4",
    title: 'Fresh Cones Lineup',
    category: 'cones',
    img: '/henna_cones.png',
    likes: 74,
    description: 'Fresh batch of smooth flowing cones made with pure Rajasthani henna powder.'
  }
];
if (!fs.existsSync(galleryPath)) {
  fs.writeFileSync(galleryPath, JSON.stringify(defaultGallery, null, 2), 'utf-8');
}

// Configure Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // limit 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|gif/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype;
    if (allowedTypes.test(ext) && allowedTypes.test(mime)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, jpeg, png, webp, gif) are allowed!'));
    }
  }
});
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'farhan1625').trim();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@skhenna.com').trim().toLowerCase();
const ADMIN2_PASSWORD = (process.env.ADMIN2_PASSWORD || 'sahla22').trim();
const ADMIN2_EMAIL = (process.env.ADMIN2_EMAIL || 'sahlajuwley22@gmail.com').trim().toLowerCase();
const BOOKING_NOTIFICATION_EMAIL = (process.env.BOOKING_NOTIFICATION_EMAIL || 'sahlajuwley22@gmail.com').trim().toLowerCase();



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
      siderConesQty: { type: Number, default: 0 },
      bridalConesQty: { type: Number, default: 0 },
      totalPrice: { type: Number, required: true, default: 0 },
      address: { type: String, required: true },
      status: { type: String, default: 'pending', enum: ['pending', 'shipped', 'completed', 'cancelled'] }
    }, { timestamps: true });

    const UserSchema = new mongoose.Schema({
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      verified: { type: Boolean, default: true }
    }, { timestamps: true });

    BookingSchema.set('toJSON', { virtuals: true });
    BookingSchema.set('toObject', { virtuals: true });
    OrderSchema.set('toJSON', { virtuals: true });
    OrderSchema.set('toObject', { virtuals: true });
    UserSchema.set('toJSON', { virtuals: true });
    UserSchema.set('toObject', { virtuals: true });

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
  siderCone: 20,
  bridalCone: 40
};

// ──────────────────────────────────────────────
// Admin Auth Middleware
// ──────────────────────────────────────────────
const adminAuth = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ message: 'No authorization token provided' });
  const password = token.replace('Bearer ', '');
  if (password === ADMIN_PASSWORD || password === ADMIN2_PASSWORD) {
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
  try {
    if (fs.existsSync(configPath)) {
      const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return res.json({
        ...configData,
        googleClientId: process.env.GOOGLE_CLIENT_ID || ''
      });
    }
  } catch (err) {
    console.error('Failed to read config, using defaults:', err);
  }
  
  res.json({
    whatsappNumber: process.env.WHATSAPP_NUMBER || '918149814003',
    whatsappNumber2: process.env.WHATSAPP_NUMBER2 || '919309463714',
    instagramId: '@Henna_by_shifa25',
    instagramUrl: 'https://www.instagram.com/Henna_by_shifa25',
    instagramId2: '@sahla_hennartist',
    instagramUrl2: 'https://www.instagram.com/sahla_hennartist',
    prices: { siderCone: 20, bridalCone: 40 },
    googleClientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});

// Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Public Gallery
app.get('/api/gallery', (req, res) => {
  try {
    if (fs.existsSync(galleryPath)) {
      const galleryData = JSON.parse(fs.readFileSync(galleryPath, 'utf-8'));
      return res.json(galleryData);
    }
    res.json([]);
  } catch (err) {
    console.error('Failed to read gallery file:', err);
    res.status(500).json({ message: 'Failed to read gallery items.' });
  }
});

// Update Configuration (Admin)
app.put('/api/admin/config', adminAuth, (req, res) => {
  try {
    const newConfig = req.body;
    if (!newConfig.whatsappNumber || !newConfig.whatsappNumber2 || !newConfig.prices) {
      return res.status(400).json({ message: 'Invalid configuration data' });
    }
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
    res.json({ message: 'Configuration updated successfully!', config: newConfig });
  } catch (err) {
    console.error('Failed to update config:', err);
    res.status(500).json({ message: 'Failed to save configuration.' });
  }
});

// Add Gallery Item (Admin)
app.post('/api/admin/gallery', adminAuth, (req, res) => {
  try {
    const { title, category, img, description, likes } = req.body;
    if (!title || !category || !img) {
      return res.status(400).json({ message: 'Title, category, and image URL are required.' });
    }
    const galleryData = JSON.parse(fs.readFileSync(galleryPath, 'utf-8'));
    const newItem = {
      id: genId(),
      title,
      category,
      img,
      description: description || '',
      likes: parseInt(likes) || 0
    };
    galleryData.push(newItem);
    fs.writeFileSync(galleryPath, JSON.stringify(galleryData, null, 2), 'utf-8');
    res.status(201).json({ message: 'Gallery item created successfully!', item: newItem });
  } catch (err) {
    console.error('Failed to add gallery item:', err);
    res.status(500).json({ message: 'Failed to save gallery item.' });
  }
});

// Edit Gallery Item (Admin)
app.put('/api/admin/gallery/:id', adminAuth, (req, res) => {
  try {
    const { title, category, img, description, likes } = req.body;
    const itemId = req.params.id;
    const galleryData = JSON.parse(fs.readFileSync(galleryPath, 'utf-8'));
    const idx = galleryData.findIndex(item => item.id.toString() === itemId.toString());
    if (idx === -1) {
      return res.status(404).json({ message: 'Gallery item not found' });
    }
    galleryData[idx] = {
      ...galleryData[idx],
      title: title || galleryData[idx].title,
      category: category || galleryData[idx].category,
      img: img || galleryData[idx].img,
      description: description !== undefined ? description : galleryData[idx].description,
      likes: likes !== undefined ? parseInt(likes) : galleryData[idx].likes
    };
    fs.writeFileSync(galleryPath, JSON.stringify(galleryData, null, 2), 'utf-8');
    res.json({ message: 'Gallery item updated successfully!', item: galleryData[idx] });
  } catch (err) {
    console.error('Failed to update gallery item:', err);
    res.status(500).json({ message: 'Failed to update gallery item.' });
  }
});

// Delete Gallery Item (Admin)
app.delete('/api/admin/gallery/:id', adminAuth, (req, res) => {
  try {
    const itemId = req.params.id;
    const galleryData = JSON.parse(fs.readFileSync(galleryPath, 'utf-8'));
    const filtered = galleryData.filter(item => item.id.toString() !== itemId.toString());
    if (filtered.length === galleryData.length) {
      return res.status(404).json({ message: 'Gallery item not found' });
    }
    fs.writeFileSync(galleryPath, JSON.stringify(filtered, null, 2), 'utf-8');
    res.json({ message: 'Gallery item deleted successfully!' });
  } catch (err) {
    console.error('Failed to delete gallery item:', err);
    res.status(500).json({ message: 'Failed to delete gallery item.' });
  }
});

// Upload image (Admin)
app.post('/api/admin/upload', adminAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, url: fileUrl });
  });
});


// Create booking
app.post('/api/bookings', async (req, res) => {
  try {
    const { clientName, phone, date, time, occasion, handDetails, address, notes } = req.body;
    if (!clientName || !phone || !date || !time || !address) {
      return res.status(400).json({ message: 'Please provide all required fields (Name, Phone, Date, Time, Address).' });
    }

    let createdBooking;
    if (dbConnected && Booking) {
      createdBooking = await Booking.create({ clientName, phone, date, time, occasion, handDetails, address, notes, status: 'pending' });
    } else {
      // In-memory fallback
      createdBooking = { _id: genId(), id: genId(), clientName, phone, date, time, occasion: occasion || 'Custom', handDetails: handDetails || 'Standard', address, notes, status: 'pending', createdAt: new Date().toISOString() };
      bookings.unshift(createdBooking);
    }

    // Send email notification to owner asynchronously (don't block the HTTP response)
    const bookingId = createdBooking.id || createdBooking._id;
    const bookingEmailHtml = `
      <div style="font-family: Georgia, serif; max-width: 550px; margin: 0 auto; background: #fffaf5; padding: 32px; border-radius: 16px; border: 1px solid #fbd38d;">
        <h1 style="color: #dd6b20; font-size: 24px; margin-bottom: 4px;">🌸 New Henna Booking!</h1>
        <p style="color: #6b7280; font-size: 14px; margin-top: 0;">Henna by Shifa & Sahla Booking Notification</p>
        <hr style="border: none; border-top: 1px solid #feebc8; margin: 20px 0;" />
        
        <h3 style="color: #9c4221; margin-top: 0;">Appointment Details</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px; width: 140px;"><strong>Booking ID:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px;">#${bookingId}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px;"><strong>Client Name:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px;">${clientName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px;"><strong>Phone:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px;">${phone}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px;"><strong>Date:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px;">${date}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px;"><strong>Time:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px;">${time}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px;"><strong>Occasion:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px; color: #b7791f; font-weight: bold;">${occasion || 'Custom'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px;"><strong>Design Area:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px;">${handDetails || 'Standard'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px;"><strong>Address:</strong></td>
            <td style="padding: 6px 0; color: #374151; font-size: 14px;">${address}</td>
          </tr>
          ${notes ? `
          <tr>
            <td style="padding: 6px 0; color: #6b7280; font-size: 14px; vertical-align: top;"><strong>Notes:</strong></td>
            <td style="padding: 6px 0; color: #4a5568; font-size: 14px; font-style: italic; background: #fffaf0; border-radius: 6px; padding: 8px;">${notes}</td>
          </tr>` : ''}
        </table>
        
        <div style="background: #fffdf5; border-radius: 12px; padding: 16px; border: 1px solid #fbd38d; text-align: center; margin-top: 20px;">
          <p style="color: #7b341e; font-size: 14px; margin: 0 0 12px 0; font-weight: bold;">Need to reach the client?</p>
          <a href="https://wa.me/${phone.replace(/[^0-9]/g, '')}" style="display: inline-block; background: #25d366; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;" target="_blank">Chat on WhatsApp</a>
        </div>
      </div>
    `;

    const bookingEmails = [...new Set([ADMIN_EMAIL, ADMIN2_EMAIL, BOOKING_NOTIFICATION_EMAIL])];
    bookingEmails.forEach(email => {
      sendNotificationEmail(email, `🌸 New Henna Booking: ${clientName} - ${occasion || 'Custom'}`, bookingEmailHtml)
        .then(() => console.log(`📧 Booking email notification sent to: ${email}`))
        .catch(err => console.error(`⚠️ Failed to send booking email notification to ${email}:`, err.message));
    });

    return res.status(201).json({ message: 'Booking created successfully!', booking: createdBooking });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ message: 'Server error. Failed to create booking.' });
  }
});

// Create bulk order
app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, phone, siderConesQty, bridalConesQty, address } = req.body;
    if (!customerName || !phone || !address) {
      return res.status(400).json({ message: 'Please provide customer name, phone, and delivery address.' });
    }

    const siderQty = parseInt(siderConesQty) || 0;
    const bridalQty = parseInt(bridalConesQty) || 0;

    if (siderQty <= 0 && bridalQty <= 0) {
      return res.status(400).json({ message: 'Order must contain at least 1 cone.' });
    }

    let currentPrices = { siderCone: 20, bridalCone: 40 };
    try {
      if (fs.existsSync(configPath)) {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (configData.prices) currentPrices = configData.prices;
      }
    } catch (e) {
      console.error('Failed to read dynamic prices:', e);
    }

    const totalPrice = (siderQty * currentPrices.siderCone) + (bridalQty * currentPrices.bridalCone);

    let createdOrder;
    if (dbConnected && Order) {
      createdOrder = await Order.create({ customerName, phone, siderConesQty: siderQty, bridalConesQty: bridalQty, totalPrice, address, status: 'pending' });
    } else {
      createdOrder = { _id: genId(), id: genId(), customerName, phone, siderConesQty: siderQty, bridalConesQty: bridalQty, totalPrice, address, status: 'pending', createdAt: new Date().toISOString() };
      orders.unshift(createdOrder);
    }

    // Send email to ADMIN asynchronously (don't block the HTTP response)
    const orderId = createdOrder.id || createdOrder._id;
    const orderEmailHtml = `
      <div style="font-family: Georgia, serif; max-width: 550px; margin: 0 auto; background: #fff7f0; padding: 32px; border-radius: 16px; border: 1px solid #fbcfe8;">
        <h1 style="color: #ec4899; font-size: 24px; margin-bottom: 4px;">🛍️ New Order Received!</h1>
        <p style="color: #6b7280; font-size: 14px; margin-top: 0;">Henna by Shifa & Sahla Store Notification</p>
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
              ${siderQty > 0 ? `
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #374151; font-size: 14px;">Sider Cone</td>
                <td style="text-align: right; padding: 8px 0; color: #374151; font-size: 14px;">${siderQty}</td>
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
        <div style="background: #fffdf5; border-radius: 12px; padding: 16px; border: 1px solid #fbcfe8; text-align: center; margin-top: 20px;">
          <p style="color: #9d174d; font-size: 14px; margin: 0 0 12px 0; font-weight: bold;">Need to reach the customer?</p>
          <a href="https://wa.me/${phone.replace(/[^0-9]/g, '')}" style="display: inline-block; background: #25d366; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;" target="_blank">Chat on WhatsApp</a>
        </div>
      </div>
    `;

    const orderEmails = [...new Set([ADMIN_EMAIL, ADMIN2_EMAIL, BOOKING_NOTIFICATION_EMAIL])];
    orderEmails.forEach(email => {
      sendNotificationEmail(email, `🛍️ New Order Received: #${orderId}`, orderEmailHtml)
        .then(() => console.log(`📧 Order email notification sent to: ${email}`))
        .catch(err => console.error(`⚠️ Failed to send order email notification to ${email}:`, err.message));
    });

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
  const clientId     = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = (process.env.GMAIL_REFRESH_TOKEN || '').trim();

  if (!clientId || !clientSecret || !refreshToken || refreshToken === 'paste_your_refresh_token_here') {
    throw new Error('Gmail OAuth2 not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in .env');
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  // Get fresh access token
  const { token: accessToken } = await oauth2Client.getAccessToken();

  // Encode subject to Base64 to prevent UTF-8 characters/emojis from corrupting the mail headers
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;

  // Build raw RFC 2822 email
  const emailLines = [
    `From: "SK Henna Security" <security@skhenna.com>`,
    `To: ${to}`,
    `Reply-To: no-reply@skhenna.com`,
    `Subject: ${encodedSubject}`,
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
  const user = (process.env.EMAIL_USER || '').trim();
  const pass = (process.env.EMAIL_PASS || '').trim();
  if (!user || !pass || pass === 'your_app_password_here') return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
};

// Unified helper to send email notifications via either App Password or Gmail REST API
async function sendNotificationEmail(to, subject, htmlBody) {
  const recipient = (to || '').trim().toLowerCase();
  const appPwdTransporter = createAppPasswordTransporter();
  if (appPwdTransporter) {
    const fromUser = (process.env.EMAIL_USER || '').trim();
    await appPwdTransporter.sendMail({
      from: `"SK Henna Security" <${fromUser}>`,
      to: recipient,
      replyTo: 'no-reply@skhenna.com',
      subject: subject,
      html: htmlBody
    });
    return;
  }

  // Fallback: Use Gmail REST API (OAuth2)
  await sendViaGmailAPI(recipient, subject, htmlBody);
}

app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }
  const emailLower = email.trim().toLowerCase();
  if (emailLower === ADMIN_EMAIL || emailLower === ADMIN2_EMAIL) {
    return res.status(400).json({ success: false, message: 'This email is reserved for admin.' });
  }

  try {
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    otpSessions.set(emailLower, { otp, expiresAt });

    const otpHtml = `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; background: #fffcfb; padding: 40px 32px; border-radius: 24px; border: 1px solid #fbd38d; box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
        <div style="text-align: center; margin-bottom: 24px;">
          <span style="color: #0f172a; font-size: 24px; font-weight: 900; letter-spacing: 0.1em; display: block; font-family: 'Cinzel', Georgia, serif;">SK HENNA</span>
          <span style="color: #b7791f; font-size: 10px; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase; display: block; margin-top: 4px;">Security Verification</span>
        </div>
        <hr style="border: none; border-top: 1px solid #fef3c7; margin: 24px 0;" />
        <p style="color: #334155; font-size: 15px; line-height: 1.5; margin-bottom: 16px;">Hello,</p>
        <p style="color: #334155; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">Please use the following secure one-time passcode (OTP) to verify your account and complete your login. This code is valid for <strong>10 minutes</strong>.</p>
        <div style="background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid #b7791f; border-radius: 16px; padding: 24px; text-align: center; margin: 24px 0; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">
          <span style="font-size: 36px; font-weight: 800; color: #f59e0b; letter-spacing: 12px; font-family: monospace; padding-left: 12px;">${otp}</span>
        </div>
        <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin-top: 24px;">For your security, do not share this code with anyone. SK Henna staff will never ask for this code.</p>
        <p style="color: #94a3b8; font-size: 11px; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center;">This is an automated security notification. Please do not reply directly to this email.</p>
      </div>
    `;

    await sendNotificationEmail(email, 'Secure Verification Code — SK Henna Artistry', otpHtml);
    console.log(`📧 OTP email sent to ${email}. Code: ${otp}`);
    res.json({ success: true, message: `OTP sent to ${emailLower}. Please check your inbox.` });
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
    const emailLower = email.trim().toLowerCase();
    const session = otpSessions.get(emailLower);
    if (!session) {
      return res.status(400).json({ success: false, message: 'OTP expired or not found. Please request a new one.' });
    }
    if (new Date() > session.expiresAt) {
      otpSessions.delete(emailLower);
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }
    if (session.otp !== otp.toString()) {
      return res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });
    }

    otpSessions.delete(emailLower);

    // Register or login user
    if (dbConnected && User) {
      let user = await User.findOne({ email: emailLower });
      if (!user) user = await User.create({ email: emailLower });
    } else {
      const existing = users.find(u => u.email === emailLower);
      if (!existing) users.push({ id: genId(), email: emailLower, createdAt: new Date().toISOString() });
    }

    // Send login notification to admins asynchronously
    const loginNotificationHtml = `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; background: #fff7f0; padding: 32px; border-radius: 16px; border: 1px solid #fbcfe8;">
        <h2 style="color: #db2777; margin-top: 0;">👤 User Login Notification</h2>
        <hr style="border: none; border-top: 1px solid #fce7f3; margin: 16px 0;" />
        <p style="color: #374151; font-size: 14px;">A user has successfully logged into the website:</p>
        <div style="background: white; border-radius: 8px; padding: 12px; border: 1px solid #fbcfe8; margin: 12px 0;">
          <span style="font-size: 16px; font-weight: bold; color: #1e293b;">${emailLower}</span>
        </div>
        <p style="color: #6b7280; font-size: 12px; margin: 16px 0 0;">Logged in via OTP</p>
      </div>
    `;
    const adminEmails = [...new Set([ADMIN_EMAIL, ADMIN2_EMAIL])];
    adminEmails.forEach(adminEmail => {
      sendNotificationEmail(adminEmail, `👤 User Login: ${emailLower}`, loginNotificationHtml)
        .then(() => console.log(`📧 Login notification sent to admin: ${adminEmail}`))
        .catch(err => console.error(`⚠️ Failed to send login notification to admin ${adminEmail}:`, err.message));
    });

    const token = Buffer.from(emailLower).toString('base64');
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

  const emailLower = email.trim().toLowerCase();
  if (emailLower === ADMIN_EMAIL || emailLower === ADMIN2_EMAIL) {
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
    const emailLower = email.trim().toLowerCase();
    const isGoogleAdmin = emailLower === ADMIN_EMAIL || emailLower === ADMIN2_EMAIL;
    const role = isGoogleAdmin ? 'admin' : 'user';
    const token = isGoogleAdmin 
      ? (emailLower === ADMIN_EMAIL ? ADMIN_PASSWORD : ADMIN2_PASSWORD) 
      : Buffer.from(emailLower).toString('base64');

    if (!isGoogleAdmin) {
      if (dbConnected && User) {
        let user = await User.findOne({ email: emailLower });
        if (!user) user = await User.create({ email: emailLower, verified: true });
      } else {
        const existing = users.find(u => u.email === emailLower);
        if (!existing) users.push({ id: genId(), email: emailLower, createdAt: new Date().toISOString() });
      }

      // Send Google login notification to admins asynchronously
      const googleLoginNotificationHtml = `
        <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; background: #fff7f0; padding: 32px; border-radius: 16px; border: 1px solid #fbcfe8;">
          <h2 style="color: #db2777; margin-top: 0;">👤 User Login Notification</h2>
          <hr style="border: none; border-top: 1px solid #fce7f3; margin: 16px 0;" />
          <p style="color: #374151; font-size: 14px;">A user has successfully logged into the website:</p>
          <div style="background: white; border-radius: 8px; padding: 12px; border: 1px solid #fbcfe8; margin: 12px 0;">
            <span style="font-size: 16px; font-weight: bold; color: #1e293b;">${emailLower}</span>
          </div>
          <p style="color: #6b7280; font-size: 12px; margin: 16px 0 0;">Logged in via Google Sign-In</p>
        </div>
      `;
      const adminEmails = [...new Set([ADMIN_EMAIL, ADMIN2_EMAIL])];
      adminEmails.forEach(adminEmail => {
        sendNotificationEmail(adminEmail, `👤 User Login (Google): ${emailLower}`, googleLoginNotificationHtml)
          .then(() => console.log(`📧 Google login notification sent to admin: ${adminEmail}`))
          .catch(err => console.error(`⚠️ Failed to send Google login notification to admin ${adminEmail}:`, err.message));
      });
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

  const emailLower = email.trim().toLowerCase();
  // Admin 1 check
  if ((emailLower === ADMIN_EMAIL || emailLower === 'admin') && password === ADMIN_PASSWORD) {
    return res.json({ success: true, role: 'admin', token: ADMIN_PASSWORD });
  }

  // Admin 2 check
  if ((emailLower === ADMIN2_EMAIL || emailLower === 'admin2') && password === ADMIN2_PASSWORD) {
    return res.json({ success: true, role: 'admin', token: ADMIN2_PASSWORD });
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

app.delete('/api/admin/bookings/:id', adminAuth, async (req, res) => {
  try {
    if (dbConnected && Booking) {
      const result = await Booking.findByIdAndDelete(req.params.id);
      if (!result) return res.status(404).json({ message: 'Booking not found.' });
      return res.json({ message: 'Booking deleted successfully.' });
    }
    const idx = bookings.findIndex(b => b._id === req.params.id || b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ message: 'Booking not found.' });
    bookings.splice(idx, 1);
    res.json({ message: 'Booking deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete booking.' });
  }
});

app.delete('/api/admin/orders/:id', adminAuth, async (req, res) => {
  try {
    if (dbConnected && Order) {
      const result = await Order.findByIdAndDelete(req.params.id);
      if (!result) return res.status(404).json({ message: 'Order not found.' });
      return res.json({ message: 'Order deleted successfully.' });
    }
    const idx = orders.findIndex(o => o._id === req.params.id || o.id === req.params.id);
    if (idx === -1) return res.status(404).json({ message: 'Order not found.' });
    orders.splice(idx, 1);
    res.json({ message: 'Order deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete order.' });
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
        totals.siderCones += (o.siderConesQty || 0) + (o.normalConesQty || 0);
        totals.bridalCones += (o.bridalConesQty || 0);
        return totals;
      }, { siderCones: 0, bridalCones: 0 });

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


