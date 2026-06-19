/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  CREER ANNONCE COMPONENT — Formulaire création/modification   ║
 * ║  Auteur : Abdessamad Ouchaib                                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Pour l'upload de photos : le fichier est d'abord envoyé vers
 * Supabase Storage (bucket public) via l'API REST Supabase, puis
 * l'URL retournée est enregistrée dans le backend Spring Boot.
 * Le backend ne gère jamais les fichiers binaires directement.
 */

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AnnonceService } from '../shared/annonce.service';
import { CategorieService } from '../shared/categorie.service';
import { AnnonceResponse, CategorieResponse } from '../shared/models';
import { environment } from '../../environments/environment';

// ── Cloudinary (remplace Supabase Storage) ──────────────────
const CLOUDINARY_CLOUD_NAME = 'dlcajfg6w'; // ex: dabcde123
const CLOUDINARY_UPLOAD_PRESET = 'souklink_photos';
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/dlcajfg6w/image/upload`;

@Component({
  selector: 'app-creer-annonce',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div class="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8">

        <h1 class="text-xl font-bold text-gray-900 mb-6">
          {{ modeModification ? 'Modifier l\'annonce' : 'Publier une annonce' }}
        </h1>

        <!-- Erreur/Succès -->
        <div *ngIf="erreur" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{{ erreur }}</div>

        <form (ngSubmit)="soumettre()" class="space-y-5">

          <!-- Titre -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Titre *</label>
            <input type="text" [(ngModel)]="titre" name="titre" required
                   placeholder="Ex : iPhone 12, Vélo VTT, Canapé en cuir..."
                   class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition">
          </div>

          <!-- Description -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea [(ngModel)]="description" name="description" rows="4"
                      placeholder="Décris ton article : état, raison de la vente, défauts éventuels..."
                      class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition resize-none"></textarea>
          </div>

          <!-- Prix et état -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Prix (MAD) *</label>
              <input type="number" [(ngModel)]="prix" name="prix" required min="0"
                     placeholder="0"
                     class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">État *</label>
              <select [(ngModel)]="etat" name="etat" required
                      class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition">
                <option value="OCCASION">Occasion</option>
                <option value="NEUF">Neuf</option>
              </select>
            </div>
          </div>

          <!-- Catégorie -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
            <select [(ngModel)]="categorieId" name="categorieId"
                    class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition">
              <option [ngValue]="undefined">Sans catégorie</option>
              <option *ngFor="let cat of categories" [ngValue]="cat.id">{{ cat.nom }}</option>
            </select>
          </div>

          <!-- Upload photos -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Photos <span class="text-gray-400 font-normal">(max 6, JPG/PNG, max 5 Mo par photo)</span>
            </label>
            <div class="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:border-primary-400 transition"
                 (dragover)="$event.preventDefault()" (drop)="onDrop($event)">
              <input type="file" id="photoInput" multiple accept="image/jpeg,image/png"
                     (change)="onFichiersSelectionnes($event)" class="hidden">
              <label for="photoInput" class="cursor-pointer">
                <p class="text-gray-400 text-sm">📸 Clique ou glisse tes photos ici</p>
                <p class="text-xs text-gray-300 mt-1">Max 6 photos · JPG, PNG · Max 5 Mo chacune</p>
              </label>
            </div>

            <!-- Aperçu photos -->
            <div *ngIf="photosUrls.length > 0" class="flex gap-2 mt-3 flex-wrap">
              <div *ngFor="let url of photosUrls; let i = index" class="relative">
                <img [src]="url" class="w-20 h-20 object-cover rounded-lg border border-gray-200">
                <button type="button" (click)="supprimerPhoto(i)"
                        class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600">
                  ×
                </button>
              </div>
              <div *ngIf="uploadEnCours" class="w-20 h-20 rounded-lg bg-gray-100 flex items-center justify-center">
                <div class="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            </div>
          </div>

          <!-- Bouton -->
          <button type="submit" [disabled]="chargement || uploadEnCours"
                  class="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition text-sm">
            {{ chargement ? 'Publication...' : (modeModification ? 'Enregistrer les modifications' : 'Publier l\'annonce') }}
          </button>
        </form>
      </div>
    </div>
  `
})
export class CreerAnnonceComponent implements OnInit {
  modeModification = false;
  annonceId?: number;
  categories: CategorieResponse[] = [];

  titre = '';
  description = '';
  prix?: number;
  etat = 'OCCASION';
  categorieId?: number;

  photosUrls: string[] = [];
  photosIdsBackend: number[] = [];
  uploadEnCours = false;
  chargement = false;
  erreur = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private annonceService: AnnonceService,
    private categorieService: CategorieService
  ) {}

  ngOnInit(): void {
    this.categorieService.listerToutes().subscribe(cats => this.categories = cats);
    this.annonceId = this.route.snapshot.paramMap.get('id')
      ? Number(this.route.snapshot.paramMap.get('id'))
      : undefined;

    if (this.annonceId) {
      this.modeModification = true;
      this.annonceService.obtenirParId(this.annonceId).subscribe((a: AnnonceResponse) => {
        this.titre = a.titre;
        this.description = a.description;
        this.prix = a.prix;
        this.etat = a.etat;
        this.categorieId = a.categorieId ?? undefined;
        this.photosUrls = a.photos.map(p => p.urlStockage);
      });
    }
  }

  async onFichiersSelectionnes(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    await this.uploadFichiers(Array.from(input.files));
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const fichiers = Array.from(event.dataTransfer?.files || []);
    await this.uploadFichiers(fichiers);
  }

  private async uploadFichiers(fichiers: File[]): Promise<void> {
  if (this.photosUrls.length + fichiers.length > 6) {
    this.erreur = 'Maximum 6 photos par annonce';
    return;
  }
  this.uploadEnCours = true;

  for (const fichier of fichiers) {
    if (fichier.size > 5 * 1024 * 1024) {
      this.erreur = `${fichier.name} dépasse 5 Mo`;
      continue;
    }

    // Cloudinary attend un FormData avec le fichier + le preset
    const formData = new FormData();
    formData.append('file', fichier);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    try {
      const reponse = await fetch(CLOUDINARY_UPLOAD_URL, {
        method: 'POST',
        body: formData
        // Pas de headers Authorization — c'est un preset "unsigned"
      });

      if (reponse.ok) {
        const data = await reponse.json();
        // Cloudinary retourne l'URL publique dans data.secure_url
        this.photosUrls.push(data.secure_url);
      } else {
        this.erreur = 'Erreur lors de l\'upload de ' + fichier.name;
      }
    } catch {
      this.erreur = 'Impossible de contacter Cloudinary';
    }
  }

  this.uploadEnCours = false;
}

  supprimerPhoto(index: number): void {
    this.photosUrls.splice(index, 1);
  }

  soumettre(): void {
    if (!this.titre || !this.prix) {
      this.erreur = 'Le titre et le prix sont obligatoires';
      return;
    }
    this.erreur = '';
    this.chargement = true;

    const request = { titre: this.titre, description: this.description, prix: this.prix, etat: this.etat as any, categorieId: this.categorieId };

    const action$ = this.modeModification && this.annonceId
      ? this.annonceService.modifier(this.annonceId, request)
      : this.annonceService.creer(request);

    action$.subscribe({
      next: async (annonce: AnnonceResponse) => {
        // Upload les URLs des photos vers le backend
        for (let i = 0; i < this.photosUrls.length; i++) {
          await this.annonceService.ajouterPhoto(annonce.id, { urlStockage: this.photosUrls[i], ordreAffichage: i }).toPromise();
        }
        this.chargement = false;
        this.router.navigate(['/annonces', annonce.id]);
      },
      error: (e: any) => {
        this.erreur = e.error?.message || 'Une erreur est survenue';
        this.chargement = false;
      }
    });
  }
}
