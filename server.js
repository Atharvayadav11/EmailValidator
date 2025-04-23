// app.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
require('dotenv').config();
const cors=require('cors');
const emailRoutes = require('./routes/emailRoutes');

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
// Routes
app.use('/api/email', emailRoutes);

// Base route
app.get('/', (req, res) => {
  res.json({
    message: 'Email Validator API',
    version: '1.0.0'
  });
});

// Connect to MongoDB
mongoose.connect( 'mongodb+srv://atharvayadav11:ashokvaishali@cluster0.twnwnbu.mongodb.net/EmailValidator?retryWrites=true&w=majority')
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
