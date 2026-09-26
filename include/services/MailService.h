#pragma once

#include <functional>
#include <string>
#include <vector>

namespace hotel::services {

/**
 * Outbound mail, behind an interface.
 *
 * ## Why an interface rather than a direct send
 *
 * The legacy `forgot.php` recovered a password by emailing a newly generated one
 * through `HoloMail`, which called PHP's `mail()`. That function hands the
 * message to a mail daemon on the *host*; there is no SMTP host, port, user or
 * password anywhere in this project, no Mailpit/MailHog in the stack, and no
 * mail setting in `phpretro_site_settings`. Adding an SMTP client is a
 * dependency decision under plan rule 9, not something to slip in.
 *
 * So delivery sits behind this interface. The only transport implemented today
 * is `MailTransport::Log`, which records exactly what *would* have been sent and
 * reports `logged` rather than `delivered`. Nothing here pretends a message was
 * delivered, and no caller may treat `logged` as delivery.
 *
 * ## What this does NOT change
 *
 * The password-reset flow itself — token generation, hashed storage, expiry,
 * single use — is fully implemented and tested; the transport choice affects
 * only how the token reaches the user. That is what makes the reset path
 * verifiable in CI today without inventing a delivery mechanism.
 */
struct MailMessage {
    std::string to;
    std::string subject;
    /** Plain text body. HTML is a transport concern and no transport needs it yet. */
    std::string body;
};

enum class MailTransport {
    /**
     * Records the message and reports success without sending it. The default,
     * and the only one that exists: the message is written to the structured log
     * so an operator can see what would have gone out.
     */
    Log,
};

enum class MailResult {
    /** Handed to a real transport that accepted it. No transport does this yet. */
    Delivered,
    /**
     * Recorded by the logging transport. The message was NOT delivered, and a
     * caller must not tell the user it was.
     */
    Logged,
    Failed,
};

class MailService {
public:
    using Sender = std::function<void(const MailMessage&, std::function<void(MailResult)>)>;

    /**
     * Send (or, today, log) one message.
     *
     * The callback always runs exactly once.
     */
    static void send(
        const MailMessage& message,
        std::function<void(MailResult)> callback
    );

    /** The transport in use. Exposed so a caller can report the truth to a user. */
    static MailTransport transport();

    // --- test seams ---------------------------------------------------
    /**
     * Swap the transport for a test and return the previous one.
     *
     * The only way to observe a message today, because the sole transport logs.
     * A test installs a sender that records into its own vector, then restores
     * with `restoreSender`.
     */
    static Sender overrideSender(Sender sender);
    static void restoreSender(Sender sender);
};

} // namespace hotel::services
