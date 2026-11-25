# SIZO — boutique de vêtements (Netlify)

Boutique homme & femme avec vitrine client et espace admin séparés. Prix en dirhams marocains (MAD), paiement à la livraison.

- Boutique : `https://NOM-DU-SITE.netlify.app/`
- Admin : `https://NOM-DU-SITE.netlify.app/admin/` (pas de lien public vers l'admin sur la boutique)

## Ce que fait le site

**Boutique** : collections Homme/Femme, fiches produit (galerie de photos, vidéo, description, pastilles de couleurs, tailles, quantité), panier conservé au rechargement, commande avec téléphone marocain validé, ville, adresse et remarque, frais de livraison, écran de confirmation, formulaire de contact/questions, lien direct par produit (`/?product=ID`).

**Admin** (4 onglets) :
- **Commandes** : liste, recherche, filtre par statut, changement de statut, appel/WhatsApp du client, export CSV.
- **Produits** : nom, prix MAD, collection, étiquette, description, couleurs (nom + couleur), tailles, plusieurs photos envoyées directement (réordonnables), une vidéo envoyée directement, produit visible/masqué.
- **Demandes clients** : messages du formulaire de contact, statut Nouvelle/Traitée.
- **Réglages** : nom/logo, textes, image d'accueil, couleurs, polices, taille du texte, téléphone, WhatsApp, email, adresse, frais de livraison et seuil de livraison offerte.

## Mise en ligne (rien n'est déployé automatiquement)

1. Mettre le contenu de ce dossier dans un dépôt GitHub.
2. Netlify : **Add new project → Import an existing project**, choisir le dépôt. Netlify lit `netlify.toml` (dossier publié `public`, fonctions `netlify/functions`) et installe `@netlify/blobs`.
3. Dans **Site configuration → Environment variables**, ajouter :
   - `ADMIN_PASSWORD` : mot de passe admin long et unique.
   - `ADMIN_TOKEN_SECRET` : longue clé aléatoire, différente du mot de passe.
4. Lancer un déploiement, ouvrir `/admin/`, se connecter, régler la boutique et ajouter les produits.

Ne mettez jamais ces secrets dans le dépôt. Les anciennes données (produits et commandes d'une version précédente) sont reprises automatiquement au premier accès admin.

## Photos et vidéos

- Photos : JPG, PNG ou WebP ; elles sont réduites (1600 px max) et converties dans le navigateur avant l'envoi. 10 photos max par produit.
- Vidéo : MP4 ou WebM, **30 Mo max**, idéalement 10 à 30 secondes. Les vidéos d'iPhone (.mov) doivent être exportées en MP4.
- Les fichiers sont stockés dans Netlify Blobs et comptent dans le quota du forfait Netlify (stockage et bande passante). Beaucoup de visites sur des vidéos peuvent consommer le quota gratuit.
- Le bouton **Supprimer les fichiers inutilisés** (onglet Réglages) nettoie les envois abandonnés.

## Sécurité

Mot de passe comparé en temps constant, jeton signé valable 8 h, limitation des tentatives de connexion, champ piège et limitation de fréquence sur les commandes et messages, contenu échappé partout, en-têtes de sécurité et politique CSP dans `netlify.toml` (aucun script en ligne). La limitation de fréquence est par instance de fonction : c'est une protection de base, pas un pare-feu.

## Structure

```
netlify.toml                    configuration Netlify (publication, redirections, en-têtes)
netlify/functions/store-api.mjs API : produits, commandes, demandes, réglages, médias, connexion
public/index.html               boutique
public/assets/store.css|js      style et logique de la boutique (+ hero.jpg)
public/admin/                   espace admin (index.html, admin.css, admin.js)
```

## Données

Netlify Blobs, un enregistrement par produit, commande, demande, fichier et réglage (`products/`, `orders/`, `inquiries/`, `media/`, `settings`), ce qui évite qu'une commande en écrase une autre.

## Environnement de prévisualisation

La branche `sizo-admin-preview` sert à tester les changements avant toute publication sur `main`.
