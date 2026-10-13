# Mise à jour Clank 0.3 — configuration simplifiée, tickets et archives

## Installation sur la version déjà déployée

1. Sauvegardez le volume Coolify `/app/data` avant la mise à jour (base et pièces jointes). Ne supprimez ni le volume ni la base.
2. Décompressez l’archive de la nouvelle version. Sur GitHub, remplacez les dossiers **src** et **public**, et mettez à jour **package.json**, **README.md**, **UPGRADE.md** et les tests si vous les utilisez. Ajoutez tous les nouveaux fichiers présents dans ces dossiers : `tickets.js`, `attachments.js`, `audit.js`, `configuration.js` et `public/settings.js` notamment. Vous pouvez importer tout le contenu de l’archive à la racine du dépôt ; elle ne contient ni secrets ni données.
3. Redéployez depuis Coolify. Aucune nouvelle variable d’environnement n’est nécessaire. Laissez le volume `/app/data` connecté. La base existante est migrée automatiquement.
4. Ne relancez pas l’installation des espaces : vos rôles, salons, thèmes et templates existants sont conservés.
5. Testez avec un ticket neuf. Sur un ancien ticket ouvert, cliquez sur **Prendre en charge** avec son responsable actuel : le bot publie les nouveaux boutons. L’ancien bouton Fermer explique désormais le nouveau parcours.

## Parcours du Support

1. Prendre le ticket en charge. Une autre personne ne peut pas prendre un ticket déjà attribué.
2. Cliquer sur **Répondre** dans Discord : le formulaire contient une liste **Tâche / Question / Solution** et un champ de réponse.
3. Une tâche ou une question laisse le ticket ouvert. Une solution affiche **Valider la solution et archiver**, réservé au demandeur.
4. Le même formulaire de réponse existe sur le dashboard pour le responsable du ticket.
5. Une nouvelle réponse remplace la solution en attente de validation : les anciens boutons ne permettent pas de valider une solution périmée.

## Validation et archives

Le demandeur valide la solution dans Discord ou dans **Mes tickets** sur le dashboard. Clank sauvegarde l’historique et télécharge les pièces jointes Discord dans `/app/data/attachments`, puis inscrit l’archive dans SQLite avant de supprimer le salon.

Il n’y a plus de fichier d’archive publié sur Discord, ni de salon d’archives requis. Le demandeur reçoit un message privé avec un lien vers son espace personnel. Le lien exige une connexion Discord avec son compte ; il ne donne pas accès aux tickets des autres personnes.

Si ses messages privés sont bloqués, l’archivage fonctionne quand même. Il peut ouvrir `https://clank.holysheet.fr/?view=mine`. Le journal et la fiche Support signalent l’échec du message privé.

Si le téléchargement d’une pièce jointe ou la lecture de l’historique échoue, le ticket reste ouvert et son salon est conservé. Si seule la suppression du salon échoue après sauvegarde, l’archive reste accessible ; le Support peut cliquer sur **Réessayer la suppression du salon**, et Clank réessaie aussi au démarrage.

Une clôture administrative avec confirmation reste disponible sur le dashboard aux admins. Les membres du Support ne peuvent pas utiliser cette exception.

Les anciennes archives et leurs salons ne sont pas supprimés automatiquement : cette mise à jour n’efface pas les historiques existants. Les anciennes pièces jointes dont les URLs ont déjà expiré ne peuvent pas être récupérées automatiquement.

## Dashboard

- **Mes tickets** : demandes et archives appartenant à la personne connectée. Accessible aux visiteurs, même sans rôle Équipe/Support. Les archives personnelles restent accessibles si le bot est hors ligne ou si la personne a quitté le serveur.
- **Tickets** : file globale réservée au Support et aux admins.
- **Configuration → Démarrage** : rôles Équipe/Support, salon de création et état de préparation. Les valeurs existantes sont conservées ; des correspondances uniques avec les espaces Holysheet peuvent être proposées pour les choix manquants, sans attribution automatique de rôle Admin.
- **Configuration → Tickets** : message d’accueil, thèmes et questions, avec aperçu pour le visiteur. Les destinations particulières et options de champs sont repliées.
- **Configuration → Projets** : noms, types et ordre des salons des futurs projets.
- **Configuration → Avancé** : rôle Admin, catégorie des tickets et maintenance.
- **Enregistrer et actualiser le panneau** sauvegarde et publie en une action. Un échec de publication conserve les réglages et affiche une possibilité de réessayer.
- Les modifications sont conservées en changeant de section et une confirmation protège la sortie sans enregistrement.
- **Activité** : libellés explicites, auteur et ticket/projet concerné ; incidents de suppression et de message privé visibles.

## Vérification après déploiement

Créer un ticket comme visiteur → le prendre comme Support → envoyer une Question, une Tâche, puis une Solution → valider comme demandeur → vérifier la disparition du salon et la lecture de l’archive dans Mes tickets. Vérifier qu’un second visiteur ne peut lire ni valider ce ticket. Vérifier aussi une pièce jointe et un demandeur qui refuse les messages privés.

Les tests automatisés couvrent les droits de lecture et de validation, les solutions périmées, les archives avant suppression, les échecs Discord, la conservation des pièces jointes, la migration et les routes HTTP protégées. Les interactions Discord réelles doivent encore être vérifiées après déploiement.
