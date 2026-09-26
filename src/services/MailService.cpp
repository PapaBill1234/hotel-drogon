#include "services/MailService.h"
#include "utils/Logger.h"

namespace hotel::services {

namespace {

/**
 * The one transport that exists: record, do not send.
 *
 * It logs the recipient and subject — never the body, which for a password reset
 * contains a single-use token that must not be written into log storage. An
 * operator reading the log learns that a message *would* have gone to an address,
 * which is what makes a missing transport diagnosable without leaking the
 * credential it carried.
 */
MailResult logTransport(const MailMessage& message) {
    HOTEL_LOG_INFO(
        "MailService: no mail transport is configured; message NOT sent "
        "(to='{}', subject='{}', {} body byte(s) withheld)",
        message.to,
        message.subject,
        message.body.size());
    return MailResult::Logged;
}

/** The process-wide sender. Swapped only by the test seams below. */
MailService::Sender& currentSender() {
    static MailService::Sender sender = [](const MailMessage& message,
                                           std::function<void(MailResult)> callback) {
        callback(logTransport(message));
    };
    return sender;
}

} // namespace

void MailService::send(const MailMessage& message, std::function<void(MailResult)> callback) {
    if (message.to.empty()) {
        // A message with no recipient is a programming error, not a delivery
        // failure: report it as such rather than logging a send that could not
        // have happened.
        HOTEL_LOG_WARN("MailService::send called without a recipient");
        if (callback) callback(MailResult::Failed);
        return;
    }
    if (!callback) return;

    currentSender()(message, [callback](MailResult result) { callback(result); });
}

MailTransport MailService::transport() {
    // One enumerator today. It exists so a future SMTP transport is a change to
    // this function and the sender above, with every caller already branching on
    // the result rather than assuming delivery.
    return MailTransport::Log;
}

MailService::Sender MailService::overrideSender(Sender sender) {
    Sender previous = currentSender();
    currentSender() = std::move(sender);
    return previous;
}

void MailService::restoreSender(Sender sender) {
    currentSender() = std::move(sender);
}

} // namespace hotel::services
