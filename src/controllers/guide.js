const router = require('express').Router();
const userSchema = require('../models/User');
const { message } = require('../messages');
const { aiCohere } = require('../integrations/cohere');
const { decodeToken } = require('../integrations/jwt');

router.get('/chatbot-model', async(req, res) => {
  const model = "cohere";
  return res.status(200).send(model);
});

router.post('/chatbot', async(req, res) => {
  try {
    const userToken = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
    const decodedToken = await decodeToken(userToken);
    const user = await userSchema.findOne({ _id: decodedToken.data.id });
    
    if (!user) return res.status(404).send({ logged: false, message: message.user.notfound });
    
    const { query } = req.body;
    const response = await aiCohere(query);

    return res.status(200).send(response);
    
  } catch (error) {
    return res.status(500).send({ error: message.user.error });
  }
});

module.exports = router;