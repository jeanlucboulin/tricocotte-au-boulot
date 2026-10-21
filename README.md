# Tricocotte au boulot

Commande d'œufs de Christelle pour les collègues de Laurent, livrés chaque lundi matin sur le lieu de travail. Boîtes de 6 œufs : taille M 2,40 €, taille L 2,80 €, taille XL 3,00 €.

## Mise en ligne

1. Déposer tout le contenu de ce dossier à la racine d'un dépôt GitHub (le fichier `netlify.toml` doit être à la racine).
2. Sur Netlify : **Add new project → Import an existing project**, choisir ce dépôt. Aucun réglage à modifier, `netlify.toml` fournit tout.
3. Dans **Project configuration → Environment variables**, créer :
   - `CHRISTELLE_PASSWORD` : le mot de passe de l'espace Christelle
   - `ADMIN_SESSION_SECRET` : une longue phrase aléatoire (elle signe les accès à l'espace Christelle)
4. **Deploys → Trigger deploy → Deploy site** pour que les variables soient prises en compte.

## Fonctionnement

- Les collègues indiquent leur nom, choisissent leurs boîtes par taille et valident. Le total est calculé côté serveur.
- Chaque commande est rattachée au prochain lundi de livraison. Les commandes sont ouvertes jusqu'au dimanche 18 h (heure de Paris) ; ensuite elles passent au lundi suivant. Réglage : constante `CUTOFF_HOUR` dans `netlify/functions/orders.mjs`.
- L'**Espace Christelle** regroupe les commandes par lundi, avec le total de boîtes par taille à préparer, le montant total, et une case « livrée » par commande. Le bouton **Effacer cette livraison** ne supprime que les commandes de ce lundi.

## Important

Ne jamais écrire le mot de passe ni le secret dans un fichier du dépôt (Netlify bloque le build si un secret est détecté). Ils restent uniquement dans les variables d'environnement de Netlify.
