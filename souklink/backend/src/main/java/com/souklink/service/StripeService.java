package com.souklink.service;

import com.souklink.dto.CheckoutResponse;
import com.souklink.dto.TransactionResponse;
import com.souklink.exception.AccesNonAutoriseException;
import com.souklink.exception.ElementNonTrouveException;
import com.souklink.exception.RequeteInvalideException;
import com.souklink.model.Annonce;
import com.souklink.model.Transaction;
import com.souklink.model.Utilisateur;
import com.souklink.repository.AnnonceRepository;
import com.souklink.repository.TransactionRepository;
import com.souklink.repository.UtilisateurRepository;
import com.stripe.Stripe;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.model.Event;
import com.stripe.model.checkout.Session;
import com.stripe.net.Webhook;
import com.stripe.param.checkout.SessionCreateParams;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class StripeService {

    private final AnnonceRepository annonceRepository;
    private final TransactionRepository transactionRepository;
    private final UtilisateurRepository utilisateurRepository;

    @Value("${stripe.secret-key}")
    private String stripeSecretKey;

    @Value("${stripe.webhook-secret}")
    private String webhookSecret;

    @Value("${app.frontend-url}")
    private String frontendUrl;

    @PostConstruct
    public void initStripe() {
        Stripe.apiKey = stripeSecretKey;
    }

    /**
     * Crée une session de paiement Stripe Checkout pour une annonce donnée.
     * La Transaction est créée en statut EN_ATTENTE — elle ne sera jamais
     * marquée PAYE ici. Seul le webhook Stripe (après vérification de signature)
     * peut confirmer le paiement. C'est une règle de sécurité non négociable.
     */
    public CheckoutResponse creerSessionCheckout(Long acheteurId, Long annonceId) {
        Annonce annonce = annonceRepository.findById(annonceId)
                .orElseThrow(() -> new ElementNonTrouveException("Annonce introuvable"));

        Utilisateur acheteur = utilisateurRepository.findById(acheteurId)
                .orElseThrow(() -> new ElementNonTrouveException("Utilisateur introuvable"));

        if (annonce.getVendeur().getId().equals(acheteurId)) {
            throw new RequeteInvalideException("Vous ne pouvez pas acheter votre propre annonce");
        }

        if (annonce.getStatut() != Annonce.StatutAnnonce.DISPONIBLE) {
            throw new RequeteInvalideException("Cette annonce n'est plus disponible à l'achat");
        }

        boolean dejaPaye = transactionRepository.existsByAnnonceIdAndAcheteurIdAndStatutPaiement(
                annonceId, acheteurId, Transaction.StatutPaiement.PAYE);
        if (dejaPaye) {
            throw new RequeteInvalideException("Vous avez déjà payé cette annonce");
        }

        // Le montant est calculé en centimes côté serveur, jamais reçu du client,
        // pour empêcher toute manipulation du prix depuis le frontend.
        long montantEnCentimes = annonce.getPrix().multiply(BigDecimal.valueOf(100)).longValue();

        SessionCreateParams params = SessionCreateParams.builder()
                .setMode(SessionCreateParams.Mode.PAYMENT)
                .setSuccessUrl(frontendUrl + "/transaction/succes?session_id={CHECKOUT_SESSION_ID}")
                .setCancelUrl(frontendUrl + "/annonces/" + annonceId)
                .setCustomerEmail(acheteur.getEmail())
                .addLineItem(
                        SessionCreateParams.LineItem.builder()
                                .setQuantity(1L)
                                .setPriceData(
                                        SessionCreateParams.LineItem.PriceData.builder()
                                                .setCurrency("usd")
                                                .setUnitAmount(montantEnCentimes)
                                                .setProductData(
                                                        SessionCreateParams.LineItem.PriceData.ProductData.builder()
                                                                .setName(annonce.getTitre())
                                                                .build()
                                                )
                                                .build()
                                )
                                .build()
                )
                .putMetadata("annonceId", String.valueOf(annonceId))
                .putMetadata("acheteurId", String.valueOf(acheteurId))
                .build();

        try {
            Session session = Session.create(params);

            Transaction transaction = new Transaction();
            transaction.setAnnonce(annonce);
            transaction.setAcheteur(acheteur);
            transaction.setMontant(annonce.getPrix());
            transaction.setStatutPaiement(Transaction.StatutPaiement.EN_ATTENTE);
            transaction.setStripeSessionId(session.getId());
            Transaction sauvegarde = transactionRepository.save(transaction);

            return new CheckoutResponse(session.getUrl(), session.getId(), sauvegarde.getId());
        } catch (Exception e) {
            throw new RequeteInvalideException("Erreur lors de la création de la session de paiement : " + e.getMessage());
        }
    }

    /**
     * Traite un événement webhook Stripe brut. La signature DOIT être vérifiée
     * avant toute lecture du contenu — sans cette vérification, n'importe qui
     * pourrait envoyer une fausse confirmation de paiement à cet endpoint public.
     */
   public void traiterWebhook(String payload, String signatureHeader) {

        Event event;

        try {

            event = Webhook.constructEvent(payload, signatureHeader, webhookSecret);

        } catch (SignatureVerificationException e) {

            throw new AccesNonAutoriseException("Signature Stripe invalide");

        }

        if ("checkout.session.completed".equals(event.getType())) {
    Session session = (Session) event.getDataObjectDeserializer()
            .getObject().orElse(null);
    if (session == null) return;

    transactionRepository.findByStripeSessionId(session.getId())
            .ifPresent(transaction -> {
                if (transaction.getStatutPaiement() == Transaction.StatutPaiement.EN_ATTENTE) {
                    transaction.setStatutPaiement(Transaction.StatutPaiement.PAYE);
                    transaction.setDatePaiement(LocalDateTime.now());
                    transactionRepository.save(transaction);

                    Annonce annonce = transaction.getAnnonce();
                    annonce.setStatut(Annonce.StatutAnnonce.VENDU);
                    annonceRepository.save(annonce);
                }
            });
} else if ("checkout.session.expired".equals(event.getType())) {

            Session session = (Session) event.getDataObjectDeserializer().getObject().orElse(null);

            if (session == null) {

                return;

            }

            transactionRepository.findByStripeSessionId(session.getId()).ifPresent(transaction -> {

                if (transaction.getStatutPaiement() == Transaction.StatutPaiement.EN_ATTENTE) {

                    transaction.setStatutPaiement(Transaction.StatutPaiement.ANNULE);

                    transactionRepository.save(transaction);

                }

            });

        }

    }
    public List<TransactionResponse> listerPourAcheteur(Long acheteurId) {
        return transactionRepository.findByAcheteurIdOrderByDateCreationDesc(acheteurId)
                .stream().map(this::versResponse).toList();
    }

    public TransactionResponse obtenirParId(Long utilisateurId, Long transactionId) {
        Transaction transaction = transactionRepository.findById(transactionId)
                .orElseThrow(() -> new ElementNonTrouveException("Transaction introuvable"));

        boolean estAcheteur = transaction.getAcheteur().getId().equals(utilisateurId);
        boolean estVendeur = transaction.getAnnonce().getVendeur().getId().equals(utilisateurId);

        if (!estAcheteur && !estVendeur) {
            throw new AccesNonAutoriseException("Vous n'avez pas accès à cette transaction");
        }

        return versResponse(transaction);
    }

    private TransactionResponse versResponse(Transaction t) {
        return new TransactionResponse(
                t.getId(), t.getAnnonce().getId(), t.getAnnonce().getTitre(), t.getAcheteur().getId(),
                t.getMontant(), t.getStatutPaiement().name(), t.getDateCreation(), t.getDatePaiement()
        );
    }
}
