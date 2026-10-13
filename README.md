# Clank · Holysheet

Bot Discord et dashboard français pour l’équipe de développement Holysheet. Une application Node.js 24, un conteneur Docker et une base SQLite persistante. Aucun abonnement à un bot tiers.

## Fonctionnement

- Tous les membres avec le rôle Équipe créent un projet depuis Discord (`/projet creer nom:...`) ou le dashboard. Toute l’équipe le voit et peut y participer.
- Une catégorie `PROJET - Nom` est créée avec cadrage, discussion, boite-a-idees, liens-utiles, decisions et Atelier (vocal). Le créateur gère les salons, les messages et les permissions dans sa catégorie. Renommage, archivage et suppression avec confirmation sont disponibles dans les deux interfaces. Les identifiants des projets figurent dans le dashboard.
- Les visiteurs choisissent un thème (Bug, Demande, Projet, Question, Autre) dans le panneau Discord, puis remplissent le titre et la description. Les admins ajoutent jusqu’à trois champs texte supplémentaires, courts ou longs, obligatoires ou facultatifs.
- Un ticket ouvert maximum par personne. Seuls son demandeur, le Support et les admins Discord le voient. L’équipe seule ne voit pas les tickets.
- Le Support prend en charge, répond et ferme dans Discord ou dans le dashboard. Les réponses web sont envoyées dans Discord ; les messages Discord apparaissent dans le dashboard, actualisé toutes les cinq secondes.
- À la fermeture : rattrapage de l’historique, archive JSON dans le salon privé d’archives et conservation SQLite, retrait d’accès au demandeur et renommage du salon. Le salon fermé reste accessible au Support. Les admins doivent organiser sa suppression périodique pour respecter la limite Discord de salons.
- Le dashboard permet de choisir les rôles, le panneau et son message, les thèmes et leurs catégories de destination, les champs et le template des futurs projets. Après modification des thèmes/messages, cliquer sur **Publier / actualiser le panneau**.
- Le bouton **Installer les espaces Holysheet** crée les rôles et espaces manquants, sans modifier les anciens salons. Il peut être relancé sans créer de doublons tant que les ressources et la base existent. Les roles Équipe/Support/Admin sont à attribuer manuellement dans Discord.

## 1. Application Discord

Dans https://discord.com/developers/applications :

1. Créer une application **Clank** et son bot.
2. Activer **Message Content Intent** sur la page Bot. Aucun Members Intent n’est requis.
3. Sur OAuth2, ajouter l’URL de redirection exacte : `https://clank.holysheet.fr/auth/callback`.
4. Inviter l’application avec les scopes `bot` et `applications.commands`, en installation serveur.
5. Permissions du bot : View Channels, Send Messages, Read Message History, Manage Channels, Manage Roles, Manage Messages, Embed Links et Attach Files. Pas de permission Administrator nécessaire.
6. Dans le serveur, placer le rôle du bot au-dessus des rôles Holysheet qu’il doit créer/gérer. Il doit aussi disposer de ces permissions dans les catégories concernées.
7. Laisser **Interactions Endpoint URL** vide : les interactions passent par le Gateway Discord.

La page OAuth2 URL Generator permet de générer le lien d’invitation. Le bot utilise uniquement le serveur `DISCORD_GUILD_ID`. L’identifiant du serveur aperçu pendant le cadrage est prérempli dans `.env.example` ; le vérifier avant déploiement.

## 2. Coolify / Docker

1. Créer une application depuis ce dépôt GitHub. Build pack **Dockerfile**, port interne **3000**. Alternative : utiliser le fichier `compose.yaml` et son volume nommé.
2. Configurer le domaine HTTPS `https://clank.holysheet.fr` et son DNS vers votre serveur Coolify.
3. Renseigner les variables dans Coolify :

| Variable                | Valeur                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`              | `production` (déjà dans l’image)                                   |
| `PUBLIC_URL`            | `https://clank.holysheet.fr`                                       |
| `DISCORD_CLIENT_ID`     | Application ID Discord                                             |
| `DISCORD_CLIENT_SECRET` | Secret OAuth2, uniquement dans Coolify                             |
| `DISCORD_BOT_TOKEN`     | Token Bot, uniquement dans Coolify                                 |
| `DISCORD_GUILD_ID`      | Identifiant de votre serveur                                       |
| `ADMIN_USER_IDS`        | Votre identifiant Discord ; plusieurs IDs séparés par des virgules |
| `DATA_DIR`              | `/app/data`                                                        |

4. Ajouter un stockage persistant sur `/app/data`. Avec Docker Compose, le volume `clank-data` est déjà déclaré. Le conteneur tourne avec l’utilisateur `node` (UID 1000) : assurer les droits d’écriture si un bind mount est utilisé.
5. Déployer une seule réplique. Ne pas partager SQLite entre plusieurs conteneurs actifs.
6. Se connecter avec Discord au dashboard, cliquer sur **Configuration → Installer les espaces Holysheet**, puis attribuer les rôles aux personnes concernées dans Discord.
7. Tester avec un compte visiteur sans rôle et un compte Équipe : un visiteur ne doit voir que le panneau Holysheet et son ticket ; l’équipe voit ses espaces et projets ; le Support voit les tickets. Les anciens salons publics restent publics tant que vous ne modifiez pas leurs permissions manuellement.

`ADMIN_USER_IDS` permet l’accès initial au dashboard à un membre du serveur. Le rôle Admin Clank permet la gestion de Clank mais n’accorde pas le pouvoir Administrateur Discord. Un vrai admin Discord voit toujours tous les salons ; Discord ne permet pas de le masquer à un Administrator.

## Configuration et sauvegardes

- La configuration, les sessions, les projets, les messages et le journal résident dans `/app/data/clank.sqlite`. Sauvegarder **tout le volume**, conteneur arrêté, ou utiliser un backup SQLite cohérent (incluant WAL si actif). Ne jamais envoyer une sauvegarde au dépôt public.
- À la reconnexion, Clank rattrape l’historique des tickets ouverts. Les messages définitivement supprimés pendant une coupure ne peuvent pas être récupérés. Une fermeture échoue si l’historique ou le salon d’archives ne peut pas être lu/écrit.
- Les archives contiennent les textes et les URLs des pièces jointes, pas les fichiers eux-mêmes. Les URLs Discord peuvent expirer : conserver les fichiers importants dans votre stockage documentaire.
- Modifier le rôle Support/Admin après des tickets nécessite une migration des permissions : le dashboard bloque ce changement pour éviter une désynchronisation des accès. Les thèmes et templates restent librement modifiables.
- Les catégories de ticket doivent être des catégories Discord ; les salons panneau et archives doivent être des salons texte. Vérifier que le salon d’archives est réservé au Support et aux admins.
- Les permissions projets sont le profil convenu : toute l’équipe participe, propriétaire gestion complète. Les permissions sont éditables dans Discord ; le dashboard configure le template des salons, pas encore des profils de permissions personnalisés.
- Le formulaire v1 utilise des champs texte ; seules les listes de thèmes sont des menus. Les champs liste, fichiers et priorités structurées sont des extensions futures.

## Développement

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# En local : PUBLIC_URL=http://localhost:3000, DATA_DIR=./data
# Ajouter http://localhost:3000/auth/callback aux redirects OAuth2
pnpm start
pnpm test
pnpm check
```

Sans variables Discord, la page de connexion et `/health` fonctionnent pour prévisualiser l’interface. Le dashboard opérationnel exige un vrai bot et un compte autorisé ; aucun mode de contournement d’authentification.

## Validation avant production

Les tests locaux vérifient configuration, limites du formulaire, sessions et persistance. Un test Discord réel exige le token et les rôles. Le build Docker exige Docker. Vérifier le parcours visiteur → ticket → réponse Discord/web → clôture → archive, puis création, renommage, archivage et suppression de projet avant ouverture aux utilisateurs.

## Sécurité

OAuth2 avec state à usage unique, sessions côté serveur expirant après huit heures, cookie HttpOnly/SameSite/Secure en production, CSRF sur les mutations et permissions vérifiées auprès de Discord à chaque requête. Les secrets ne sont jamais stockés dans la base ni envoyés au navigateur. Les messages sont affichés en texte, sans HTML utilisateur ni mentions automatiques. Le proxy Coolify doit être le seul point d’entrée réseau (un proxy de confiance est configuré).
