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
    .addUserOption(o =>
      o.setName('cible')
       .setDescription('Utilisateur du PC ciblé (laisser vide = tout le monde)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('text')
       .setDescription('Texte affiché sous la vidéo')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('tts')
       .setDescription('Nom de la voix TTS (ex: "mario", "robot"). Laissez vide pour aucun.')
       .setRequired(false))
    .addBooleanOption(o =>
      o.setName('greenscreen')
       .setDescription('Applique un filtre green screen pour enlever le fond vert')
       .setRequired(false)),

  new SlashCommandBuilder()
    .setName('sendfile')
    .setDescription('Envoie une image ou un son sur l\'écran d\'un PC')
    .addAttachmentOption(o =>
      o.setName('fichier')
       .setDescription('Image ou fichier audio')
       .setRequired(true))
    .addUserOption(o =>
      o.setName('cible')
       .setDescription('Utilisateur du PC ciblé (laisser vide = tout le monde)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('text')
       .setDescription('Texte affiché sous l\'image')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('tts')
       .setDescription('Nom de la voix TTS (ex: "mario", "robot"). Laissez vide pour aucun.')
       .setRequired(false))
    .addBooleanOption(o =>
      o.setName('greenscreen')
       .setDescription('Applique un filtre green screen pour enlever le fond vert')
       .setRequired(false)),

  new SlashCommandBuilder()
    .setName('message')
    .setDescription('Affiche un message en gros sur l\'écran d\'un PC')
    .addStringOption(o =>
      o.setName('texte')
       .setDescription('Le message à afficher (max 200 caractères)')
       .setRequired(true)
       .setMaxLength(200))
    .addUserOption(o =>
      o.setName('cible')
       .setDescription('Utilisateur du PC ciblé (laisser vide = tout le monde)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('tts')
       .setDescription('Nom de la voix TTS (ex: "mario", "robot"). Laissez vide pour aucun.')
       .setRequired(false))
    .addBooleanOption(o =>
      o.setName('greenscreen')
       .setDescription('Applique un filtre green screen pour enlever le fond vert')
       .setRequired(false)),

  new SlashCommandBuilder()
    .setName('online')
    .setDescription('Affiche la liste des PCs actuellement connectés'),

  new SlashCommandBuilder()
    .setName('tuto')
    .setDescription('Affiche un tutoriel sur le fonctionnement du bot et ses commandes'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Affiche les statistiques d\'envoi (médias, messages) d\'un utilisateur')
    .addUserOption(o =>
      o.setName('utilisateur')
       .setDescription('Utilisateur dont on veut voir les stats')
       .setRequired(false)),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Affiche le top des personnes qui ont envoyé le plus de médias'),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Affiche la file d\'attente des médias pour un PC')
    .addStringOption(o =>
      o.setName('cible')
       .setDescription('Le PC cible ("all" ou un pseudo, laissez vide pour voir toutes les files)')
       .setRequired(false)),

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
