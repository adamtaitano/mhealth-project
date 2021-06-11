const mongoose = require('mongoose');

const { Schema } = mongoose;

const UsersSchema = new Schema({
  provider: String,
  id: String,
  displayName: String,
});

UsersSchema.methods.toAuthJSON = function() {
  return {
    _id: this._id,
    email: this.email,
    token: this.generateJWT(),
  };
};

mongoose.model('Users', UsersSchema);
