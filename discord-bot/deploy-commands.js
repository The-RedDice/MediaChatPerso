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
       .setRequired(false)
       .setAutocomplete(true))
    .addBooleanOption(o =>
      o.setName('greenscreen')
       .setDescription('Applique un filtre green screen pour enlever le fond vert')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('couleur')
       .setDescription('Override la couleur (ex: red)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('filtre')
       .setDescription('Applique un filtre visuel')
       .setRequired(false)
       .addChoices(
         { name: 'Noir & Blanc', value: 'grayscale' },
         { name: 'Sépia', value: 'sepia' },
         { name: 'Négatif', value: 'invert' },
         { name: 'Flou', value: 'blur' },
         { name: 'Contraste Élevé', value: 'contrast' },
         { name: 'Saturation Max', value: 'saturate' },
         { name: 'Pixelisé (Retro)', value: 'pixelate' },
         { name: 'Psychédélique', value: 'hue-rotate' },
         { name: 'Lueur (Glow)', value: 'brightness' }
       ))
    .addStringOption(o =>
      o.setName('police')
       .setDescription('Override la police')
       .setRequired(false)
       .addChoices(
         { name: 'Pixel (Retro)', value: '"Press Start 2P"' },
         { name: 'Horreur', value: 'Creepster' },
         { name: 'Impact (Meme)', value: 'Impact' },
         { name: 'Comic Sans MS (Troll)', value: '"Comic Sans MS"' },
         { name: 'Courier New (Machine à écrire)', value: '"Courier New"' },
         { name: 'Arial', value: 'Arial' },
         { name: 'Georgia', value: 'Georgia' },
         { name: 'Bangers (Comics)', value: 'Bangers' },
         { name: 'Oswald (Gras)', value: 'Oswald' },
         { name: 'Cinzel (Épique)', value: 'Cinzel' }
       ))
    .addStringOption(o =>
      o.setName('animation')
       .setDescription('Override l\'animation')
       .setRequired(false)
       .addChoices(
         { name: 'Glitch', value: 'glitch' },
         { name: 'Machine à écrire', value: 'typewriter' },
         { name: 'Pulse', value: 'pulse' },
         { name: 'Fondu (Fade)', value: 'fade' },
         { name: 'Glissement (Slide)', value: 'slide' },
         { name: 'Rebond (Bounce)', value: 'bounce' },
         { name: 'Zoom', value: 'zoom' },
         { name: 'Rotation (Spin)', value: 'spin' },
         { name: 'Tremblement (Shake)', value: 'shake' },
         { name: 'Chute (Drop)', value: 'drop' },
         { name: 'Swing', value: 'swing' },
         { name: 'Wobble', value: 'wobble' },
         { name: 'Flip', value: 'flip' }
       ))
    .addStringOption(o =>
      o.setName('effet')
       .setDescription('Override l\'effet')
       .setRequired(false)
       .addChoices(
         { name: 'Aucun', value: 'aucun' },
         { name: 'Neige', value: 'neige' },
         { name: 'Cœurs', value: 'coeurs' },
         { name: 'Matrix', value: 'matrix' },
         { name: 'Particules', value: 'particules' },
         { name: 'Étoiles', value: 'etoiles' },
         { name: 'Confetti', value: 'confetti' },
         { name: 'Feu', value: 'feu' },
         { name: 'Pluie', value: 'pluie' },
         { name: 'Bulles', value: 'bulles' },
         { name: 'Éclairs', value: 'eclairs' }
       )),

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
       .setRequired(false)
       .setAutocomplete(true))
    .addBooleanOption(o =>
      o.setName('greenscreen')
       .setDescription('Applique un filtre green screen pour enlever le fond vert')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('couleur')
       .setDescription('Override la couleur (ex: red)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('filtre')
       .setDescription('Applique un filtre visuel')
       .setRequired(false)
       .addChoices(
         { name: 'Noir & Blanc', value: 'grayscale' },
         { name: 'Sépia', value: 'sepia' },
         { name: 'Négatif', value: 'invert' },
         { name: 'Flou', value: 'blur' },
         { name: 'Contraste Élevé', value: 'contrast' },
         { name: 'Saturation Max', value: 'saturate' },
         { name: 'Pixelisé (Retro)', value: 'pixelate' },
         { name: 'Psychédélique', value: 'hue-rotate' },
         { name: 'Lueur (Glow)', value: 'brightness' }
       ))
    .addStringOption(o =>
      o.setName('police')
       .setDescription('Override la police')
       .setRequired(false)
       .addChoices(
         { name: 'Pixel (Retro)', value: '"Press Start 2P"' },
         { name: 'Horreur', value: 'Creepster' },
         { name: 'Impact (Meme)', value: 'Impact' },
         { name: 'Comic Sans MS (Troll)', value: '"Comic Sans MS"' },
         { name: 'Courier New (Machine à écrire)', value: '"Courier New"' },
         { name: 'Arial', value: 'Arial' },
         { name: 'Georgia', value: 'Georgia' },
         { name: 'Bangers (Comics)', value: 'Bangers' },
         { name: 'Oswald (Gras)', value: 'Oswald' },
         { name: 'Cinzel (Épique)', value: 'Cinzel' }
       ))
    .addStringOption(o =>
      o.setName('animation')
       .setDescription('Override l\'animation')
       .setRequired(false)
       .addChoices(
         { name: 'Glitch', value: 'glitch' },
         { name: 'Machine à écrire', value: 'typewriter' },
         { name: 'Pulse', value: 'pulse' },
         { name: 'Fondu (Fade)', value: 'fade' },
         { name: 'Glissement (Slide)', value: 'slide' },
         { name: 'Rebond (Bounce)', value: 'bounce' },
         { name: 'Zoom', value: 'zoom' },
         { name: 'Rotation (Spin)', value: 'spin' },
         { name: 'Tremblement (Shake)', value: 'shake' },
         { name: 'Chute (Drop)', value: 'drop' },
         { name: 'Swing', value: 'swing' },
         { name: 'Wobble', value: 'wobble' },
         { name: 'Flip', value: 'flip' }
       ))
    .addStringOption(o =>
      o.setName('effet')
       .setDescription('Override l\'effet')
       .setRequired(false)
       .addChoices(
         { name: 'Aucun', value: 'aucun' },
         { name: 'Neige', value: 'neige' },
         { name: 'Cœurs', value: 'coeurs' },
         { name: 'Matrix', value: 'matrix' },
         { name: 'Particules', value: 'particules' },
         { name: 'Étoiles', value: 'etoiles' },
         { name: 'Confetti', value: 'confetti' },
         { name: 'Feu', value: 'feu' },
         { name: 'Pluie', value: 'pluie' },
         { name: 'Bulles', value: 'bulles' },
         { name: 'Éclairs', value: 'eclairs' }
       )),

  new SlashCommandBuilder()
    .setName('event')
    .setDescription('Lance un événement interactif (Boss ou Sondage) sur l\'overlay')
    .addSubcommand(subcommand =>
      subcommand
        .setName('boss')
        .setDescription('Fait apparaître un Boss à vaincre')
        .addStringOption(option => option.setName('nom').setDescription('Nom du Boss').setRequired(true))
        .addAttachmentOption(option => option.setName('image').setDescription('Image du Boss').setRequired(false))
        .addBooleanOption(o => o.setName('greenscreen').setDescription('Enlever le fond vert ? (si fond vert)').setRequired(false))
        .addStringOption(o => o.setName('filter').setDescription('Appliquer un filtre visuel').setRequired(false).addChoices(
          { name: 'Aucun', value: 'aucun' },
          { name: 'N&B', value: 'grayscale' },
          { name: 'Sépia', value: 'sepia' },
          { name: 'Inverser', value: 'invert' },
          { name: 'Flou', value: 'blur' },
          { name: 'Contraste', value: 'contrast' },
          { name: 'Pixel', value: 'pixelate' },
          { name: 'Hue', value: 'hue' }
        ))
        .addStringOption(o => o.setName('effet').setDescription('Appliquer un effet').setRequired(false).addChoices(
          { name: 'Aucun', value: 'aucun' },
          { name: 'Neige', value: 'neige' },
          { name: 'Cœurs', value: 'coeurs' },
          { name: 'Matrix', value: 'matrix' },
          { name: 'Particules', value: 'particules' },
          { name: 'Étoiles', value: 'etoiles' },
          { name: 'Confetti', value: 'confetti' },
          { name: 'Feu', value: 'feu' },
          { name: 'Pluie', value: 'pluie' },
          { name: 'Bulles', value: 'bulles' },
          { name: 'Éclairs', value: 'eclairs' }
        )))
    .addSubcommand(subcommand =>
      subcommand
        .setName('sondage')
        .setDescription('Affiche un sondage en temps réel')
        .addStringOption(option => option.setName('question').setDescription('La question').setRequired(true))
        .addStringOption(option => option.setName('choix1').setDescription('Choix 1').setRequired(true))
        .addStringOption(option => option.setName('choix2').setDescription('Choix 2').setRequired(true))
        .addStringOption(option => option.setName('choix3').setDescription('Choix 3 (optionnel)').setRequired(false))
        .addStringOption(option => option.setName('choix4').setDescription('Choix 4 (optionnel)').setRequired(false))),

  new SlashCommandBuilder()
    .setName('ai')
    .setDescription('Génère un message IA fun et l\'affiche sur l\'écran d\'un PC')
    .addStringOption(o =>
      o.setName('prompt')
       .setDescription('Le sujet du message (ex: "Raconte une blague sur les chats")')
       .setRequired(true))
    .addUserOption(o =>
      o.setName('cible')
       .setDescription('Utilisateur du PC ciblé (laisser vide = tout le monde)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('tts')
       .setDescription('Nom de la voix TTS (ex: "mario", "robot"). Laissez vide pour aucun.')
       .setRequired(false)
       .setAutocomplete(true))
    .addBooleanOption(o =>
      o.setName('greenscreen')
       .setDescription('Applique un filtre green screen pour enlever le fond vert')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('couleur')
       .setDescription('Override la couleur (ex: red)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('police')
       .setDescription('Override la police')
       .setRequired(false)
       .addChoices(
         { name: 'Pixel (Retro)', value: '"Press Start 2P"' },
         { name: 'Horreur', value: 'Creepster' },
         { name: 'Impact (Meme)', value: 'Impact' },
         { name: 'Comic Sans MS (Troll)', value: '"Comic Sans MS"' },
         { name: 'Courier New (Machine à écrire)', value: '"Courier New"' },
         { name: 'Arial', value: 'Arial' },
         { name: 'Georgia', value: 'Georgia' },
         { name: 'Bangers (Comics)', value: 'Bangers' },
         { name: 'Oswald (Gras)', value: 'Oswald' },
         { name: 'Cinzel (Épique)', value: 'Cinzel' }
       ))
    .addStringOption(o =>
      o.setName('animation')
       .setDescription('Override l\'animation')
       .setRequired(false)
       .addChoices(
         { name: 'Glitch', value: 'glitch' },
         { name: 'Machine à écrire', value: 'typewriter' },
         { name: 'Pulse', value: 'pulse' },
         { name: 'Fondu (Fade)', value: 'fade' },
         { name: 'Glissement (Slide)', value: 'slide' },
         { name: 'Rebond (Bounce)', value: 'bounce' },
         { name: 'Zoom', value: 'zoom' },
         { name: 'Rotation (Spin)', value: 'spin' },
         { name: 'Tremblement (Shake)', value: 'shake' },
         { name: 'Chute (Drop)', value: 'drop' },
         { name: 'Swing', value: 'swing' },
         { name: 'Wobble', value: 'wobble' },
         { name: 'Flip', value: 'flip' }
       ))
    .addStringOption(o =>
      o.setName('effet')
       .setDescription('Override l\'effet')
       .setRequired(false)
       .addChoices(
         { name: 'Aucun', value: 'aucun' },
         { name: 'Neige', value: 'neige' },
         { name: 'Cœurs', value: 'coeurs' },
         { name: 'Matrix', value: 'matrix' },
         { name: 'Particules', value: 'particules' },
         { name: 'Étoiles', value: 'etoiles' },
         { name: 'Confetti', value: 'confetti' },
         { name: 'Feu', value: 'feu' },
         { name: 'Pluie', value: 'pluie' },
         { name: 'Bulles', value: 'bulles' },
         { name: 'Éclairs', value: 'eclairs' }
       )),

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
       .setRequired(false)
       .setAutocomplete(true))
    .addBooleanOption(o =>
      o.setName('greenscreen')
       .setDescription('Applique un filtre green screen pour enlever le fond vert')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('couleur')
       .setDescription('Override la couleur (ex: red)')
       .setRequired(false))
    .addStringOption(o =>
      o.setName('police')
       .setDescription('Override la police')
       .setRequired(false)
       .addChoices(
         { name: 'Pixel (Retro)', value: '"Press Start 2P"' },
         { name: 'Horreur', value: 'Creepster' },
         { name: 'Impact (Meme)', value: 'Impact' },
         { name: 'Comic Sans MS (Troll)', value: '"Comic Sans MS"' },
         { name: 'Courier New (Machine à écrire)', value: '"Courier New"' },
         { name: 'Arial', value: 'Arial' },
         { name: 'Georgia', value: 'Georgia' },
         { name: 'Bangers (Comics)', value: 'Bangers' },
         { name: 'Oswald (Gras)', value: 'Oswald' },
         { name: 'Cinzel (Épique)', value: 'Cinzel' }
       ))
    .addStringOption(o =>
      o.setName('animation')
       .setDescription('Override l\'animation')
       .setRequired(false)
       .addChoices(
         { name: 'Glitch', value: 'glitch' },
         { name: 'Machine à écrire', value: 'typewriter' },
         { name: 'Pulse', value: 'pulse' },
         { name: 'Fondu (Fade)', value: 'fade' },
         { name: 'Glissement (Slide)', value: 'slide' },
         { name: 'Rebond (Bounce)', value: 'bounce' },
         { name: 'Zoom', value: 'zoom' },
         { name: 'Rotation (Spin)', value: 'spin' },
         { name: 'Tremblement (Shake)', value: 'shake' },
         { name: 'Chute (Drop)', value: 'drop' },
         { name: 'Swing', value: 'swing' },
         { name: 'Wobble', value: 'wobble' },
         { name: 'Flip', value: 'flip' }
       ))
    .addStringOption(o =>
      o.setName('effet')
       .setDescription('Override l\'effet')
       .setRequired(false)
       .addChoices(
         { name: 'Aucun', value: 'aucun' },
         { name: 'Neige', value: 'neige' },
         { name: 'Cœurs', value: 'coeurs' },
         { name: 'Matrix', value: 'matrix' },
         { name: 'Particules', value: 'particules' },
         { name: 'Étoiles', value: 'etoiles' },
         { name: 'Confetti', value: 'confetti' },
         { name: 'Feu', value: 'feu' },
         { name: 'Pluie', value: 'pluie' },
         { name: 'Bulles', value: 'bulles' },
         { name: 'Éclairs', value: 'eclairs' }
       )),

  new SlashCommandBuilder()
    .setName('online')
    .setDescription('Affiche la liste des PCs actuellement connectés'),

  new SlashCommandBuilder()
    .setName('tuto')
    .setDescription('Affiche un tutoriel sur le fonctionnement du bot et ses commandes'),

  new SlashCommandBuilder()
    .setName('meme')
    .setDescription('Gère et joue vos mèmes personnels')
    .addSubcommand(subcommand =>
      subcommand
        .setName('play')
        .setDescription('Joue un mème de votre collection personnelle')
        .addStringOption(option =>
          option.setName('nom')
            .setDescription('Le nom du mème à jouer')
            .setRequired(true)
            .setAutocomplete(true))
        .addUserOption(option =>
          option.setName('cible')
            .setDescription('Utilisateur du PC ciblé (laisser vide = tout le monde)')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('Affiche la liste de vos mèmes personnels enregistrés'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Supprime un mème de votre collection personnelle')
        .addStringOption(option =>
          option.setName('nom')
            .setDescription('Le nom du mème à supprimer')
            .setRequired(true)
            .setAutocomplete(true))),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Affiche les statistiques complètes et le style visuel d\'un utilisateur')
    .addUserOption(o =>
      o.setName('utilisateur')
       .setDescription('Utilisateur dont on veut voir le profil')
       .setRequired(false)),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Affiche le top des utilisateurs')
    .addStringOption(o =>
      o.setName('type')
       .setDescription('Le type de classement à afficher')
       .setRequired(false)
       .addChoices(
         { name: 'Top BordelCoins', value: 'coins' },
         { name: 'Top Médias Envoyés', value: 'media' },
         { name: 'Top Flop (Skip)', value: 'flop' }
       )),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Affiche la file d\'attente des médias pour un PC')
    .addUserOption(o =>
      o.setName('cible')
       .setDescription('Utilisateur du PC ciblé (laisser vide pour voir toutes les files)')
       .setRequired(false)),

  new SlashCommandBuilder()
    .setName('style')
    .setDescription('Ouvre un menu interactif pour personnaliser l\'affichage de vos envois (couleur, animation, police)'),

  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Ouvre la boutique pour acheter des polices, animations et effets avec vos BordelCoins'),

  new SlashCommandBuilder()
    .setName('download')
    .setDescription('Télécharge la dernière version du client BordelBox (depuis GitHub)'),

  new SlashCommandBuilder()
    .setName('upload')
    .setDescription('Obtenir le lien de la page web pour envoyer des fichiers directement depuis votre PC'),

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
