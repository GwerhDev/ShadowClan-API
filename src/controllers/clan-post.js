const router     = require('express').Router();
const ClanPost   = require('../models/ClanPost');
const Character  = require('../models/Character');
const Clan       = require('../models/Clan');
const User       = require('../models/User');
const { decodeToken } = require('../integrations/jwt');
const { message } = require('../messages');

async function getUser(req) {
  const token = req.cookies['u_tkn'] || req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  const decoded = await decodeToken(token);
  return User.findById(decoded.data.id);
}

// GET / — posts for the current character's clan (latest first, paginated)
router.get('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const charIds = (user.character ?? []).map(String);
    if (!charIds.length) return res.status(200).json([]);

    // Find the clan of the active character (sent as query param, falls back to any)
    const characterId = req.query.characterId;
    let clanId = null;

    if (characterId && charIds.includes(characterId)) {
      const char = await Character.findById(characterId).select('clan');
      clanId = char?.clan ?? null;
    }

    if (!clanId) {
      // fallback: find clan from any character
      const chars = await Character.find({ _id: { $in: charIds } }).select('clan');
      clanId = chars.find(c => c.clan)?.clan ?? null;
    }

    if (!clanId) return res.status(200).json([]);

    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const skip  = (page - 1) * limit;

    const [posts, clan] = await Promise.all([
      ClanPost.find({ clan: clanId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('author', 'name currentClass resonance')
        .lean(),
      Clan.findById(clanId).select('leader officer').lean(),
    ]);

    const leaderStr  = String(clan?.leader ?? '');
    const officerSet = new Set((clan?.officer ?? []).map(String));

    const result = posts.map(post => {
      const authorId = String(post.author?._id ?? '');
      const authorRole =
        authorId === leaderStr   ? 'leader'  :
        officerSet.has(authorId) ? 'officer' : 'member';
      return { ...post, authorRole };
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

// POST / — create a post in the current character's clan
router.post('/', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const { content, characterId, source } = req.body;
    const isShadowWar = source === 'shadow_war';
    if (!content?.trim() && !isShadowWar) return res.status(400).json({ message: 'El contenido no puede estar vacío.' });

    const charIds = (user.character ?? []).map(String);
    if (!characterId || !charIds.includes(String(characterId))) {
      return res.status(403).json({ message: 'No tienes acceso a este personaje.' });
    }

    const char = await Character.findById(characterId).select('clan');
    if (!char?.clan) return res.status(400).json({ message: 'El personaje no pertenece a ningún clan.' });

    const post = await ClanPost.create({
      clan:    char.clan,
      author:  characterId,
      content: content.trim(),
      source:  source === 'shadow_war' ? 'shadow_war' : 'general',
    });

    const populated = await ClanPost.findById(post._id)
      .populate('author', 'name currentClass resonance')
      .lean();

    return res.status(201).json(populated);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

// PATCH /:id — leader or officer can edit post content
router.patch('/:id', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const post = await ClanPost.findById(req.params.id).populate('clan', 'leader officer');
    if (!post) return res.status(404).json({ message: 'Publicación no encontrada.' });

    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ message: 'El contenido no puede estar vacío.' });

    const charIds = (user.character ?? []).map(String);
    const clan    = post.clan;
    const isAdmin = ['admin', 'super_admin'].includes(user.role);

    const isLeaderOrOfficer =
      charIds.includes(String(clan.leader)) ||
      (clan.officer ?? []).some(o => charIds.includes(String(o)));

    if (!isAdmin && !isLeaderOrOfficer) {
      return res.status(403).json({ message: 'No tienes permisos para editar esta publicación.' });
    }

    post.content = content.trim();
    await post.save();

    const updated = await ClanPost.findById(post._id)
      .populate('author', 'name currentClass resonance')
      .lean();

    return res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

// DELETE /:id — leader or officer of the post's clan can delete it
router.delete('/:id', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ message: message.user.unauthorized });

    const post = await ClanPost.findById(req.params.id).populate('clan', 'leader officer');
    if (!post) return res.status(404).json({ message: 'Publicación no encontrada.' });

    const charIds = (user.character ?? []).map(String);
    const clan    = post.clan;
    const isAdmin = ['admin', 'super_admin'].includes(user.role);

    const isLeaderOrOfficer =
      charIds.includes(String(clan.leader)) ||
      (clan.officer ?? []).some(o => charIds.includes(String(o)));

    if (!isAdmin && !isLeaderOrOfficer) {
      return res.status(403).json({ message: 'No tienes permisos para eliminar esta publicación.' });
    }

    await ClanPost.findByIdAndDelete(req.params.id);
    return res.status(200).json({ message: 'Publicación eliminada.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: message.user.error });
  }
});

module.exports = router;
