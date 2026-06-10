const mongoose = require('mongoose');

const poklandOperatorSchema = new mongoose.Schema({
  pokland: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pokland',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    default: '',
    validate: {
      // Allows empty string, but if data is entered, it must be exactly 10 digits
      validator: function(v) {
        return v === '' || /^\d{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid 10-digit phone number!`
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
}, { timestamps: true });

module.exports = mongoose.model('PoklandOperator', poklandOperatorSchema);