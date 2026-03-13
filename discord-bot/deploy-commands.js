/**
 * deploy-commands.js
 * À exécuter une seule fois (ou quand les commandes changent) :
 *   node deploy-commands.js
 */

'use strict';

require('dotenv').config({ path: '../.env' });

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID  = process.env.DISCORD_GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('❌  DISCORD_TOKEN, DISCORD_CLIENT_ID et DISCORD_GUILD_ID sont requis dans .env');
  process.exit(1);
}

// ─── Définition des commandes ────────────────────────────

const commands = [

  new SlashCommandBuilder()
    .setName('sendurl')
    .setDescription('Envoie une vidéo YouTube/TikTok sur l\'écran d\'un PC')
    .addStringOption(o =>
      o.setName('lien')
       .setDescription('URL YouTube ou TikTok')
       .setRequired(true))
    .addStringOption(o =>
      o.setName('cible')
       .setDescription('Pseudo du PC ciblé (laisser vide = tout le monde)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('text')
       .setDescription('Texte affiché sous la vidéo')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('caption')
       .setDescription('Ancien nom pour "text" (gardé par rétro-compatibilité)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('tts')
       .setDescription('Nom de la voix TTS (ex: "mario", "robot"). Laissez vide pour aucun.')
       .setRequired(false)),

  new SlashCommandBuilder()
    .setName('sendfile')
    .setDescription('Envoie une image ou un son sur l\'écran d\'un PC')
    .addAttachmentOption(o =>
      o.setName('fichier')
       .setDescription('Image ou fichier audio')
       .setRequired(true))
    .addStringOption(o =>
      o.setName('cible')
       .setDescription('Pseudo du PC ciblé (laisser vide = tout le monde)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('text')
       .setDescription('Texte affiché sous l\'image')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('caption')
       .setDescription('Ancien nom pour "text" (gardé par rétro-compatibilité)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('tts')
       .setDescription('Nom de la voix TTS (ex: "mario", "robot"). Laissez vide pour aucun.')
       .setRequired(false)),

  new SlashCommandBuilder()
    .setName('message')
    .setDescription('Affiche un message en gros sur l\'écran d\'un PC')
    .addStringOption(o =>
      o.setName('texte')
       .setDescription('Le message à afficher (max 200 caractères)')
       .setRequired(true)
       .setMaxLength(200))
    .addStringOption(o =>
      o.setName('cible')
       .setDescription('Pseudo du PC ciblé (laisser vide = tout le monde)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('tts')
       .setDescription('Nom de la voix TTS (ex: "mario", "robot"). Laissez vide pour aucun.')
       .setRequired(false)),

  new SlashCommandBuilder()
    .setName('online')
    .setDescription('Affiche la liste des PCs actuellement connectés'),

].map(cmd => cmd.toJSON());

// ─── Déploiement ─────────────────────────────────────────

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log(`🔄  Déploiement de ${commands.length} commande(s) sur le serveur ${GUILD_ID}…`);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands },
    );

    console.log('✅  Commandes déployées avec succès !');
  } catch (err) {
    console.error('❌  Erreur lors du déploiement :', err);
  }
})();
