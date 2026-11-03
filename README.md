# GEM — application de suivi

Application web de suivi du démontage Versailles GEM.

## Fichiers

- `index.html` : structure de la page
- `styles.css` : styles et mise en page responsive
- `app.js` : carte, interface et échanges avec Supabase
- `supabase-update-baies.sql` : mise à jour du schéma Supabase pour les baies et les machines
- `supabase-update-wifi.sql` : mise à jour du schéma Supabase pour les bornes Wi-Fi

## Mise à jour Supabase

Avant d'utiliser la gestion des baies, exécuter `supabase-update-baies.sql` dans le SQL Editor du projet Supabase. Le script ajoute la catégorie `Baies`, distingue les profils de machines des profils d'enceintes et ajoute la liste de machines à chaque point de baie. Si l'application demande aussi `supabase-update-materiel.sql`, exécuter cette migration existante avant celle des baies.

Les machines se créent dans **Matériel**, dans la section **Amplificateurs et processeurs**. En mode édition, affecter ensuite la catégorie **Baies** à un point pour ajouter les modèles et quantités qu'il contient.

Pour les bornes Wi-Fi, exécuter ensuite `supabase-update-wifi.sql`. La section **Bornes Wi-Fi** conserve le SSID et l'identifiant pour les comptes connectés. Les mots de passe sont stockés séparément et ne sont accessibles qu'aux administrateurs. En mode édition, affecter la catégorie **Wi-Fi** à un point et choisir la borne correspondante.

## Développement

Ouvrir `index.html` dans un navigateur connecté au projet Supabase configuré dans `app.js`.
