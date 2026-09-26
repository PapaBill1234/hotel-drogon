#include <catch2/catch_test_macros.hpp>

#include <string>
#include <vector>

#include "services/MailService.h"

using namespace hotel::services;

/**
 * The mail abstraction's own contract.
 *
 * There is no mail transport in this project — no SMTP client, no Mailpit, no
 * mail setting — so delivery sits behind this interface and the only transport
 * logs. What must hold without a network is that the interface reports the
 * *truth*: a logged message is never reported as delivered, a message with no
 * recipient is a failure rather than a silent success, and the callback always
 * runs exactly once. Everything a caller can believe about delivery rests on
 * those three.
 */
TEST_CASE("MailService reports delivery honestly", "[mail]") {
    SECTION("the only transport is the log-only one") {
        // If this ever returns something else, the reset flow's messaging grows a
        // real delivery path and every caller's `Logged != Delivered` branch has
        // to be re-read.
        REQUIRE(MailService::transport() == MailTransport::Log);
    }

    SECTION("the default transport logs and does NOT claim delivery") {
        int calls = 0;
        MailResult observed = MailResult::Failed;
        MailService::send(
            MailMessage{"someone@example.test", "subject", "body"},
            [&](MailResult result) {
                ++calls;
                observed = result;
            });
        REQUIRE(calls == 1);
        REQUIRE(observed == MailResult::Logged);
        REQUIRE(observed != MailResult::Delivered);
    }

    SECTION("a message with no recipient fails instead of pretending") {
        int calls = 0;
        MailResult observed = MailResult::Delivered;
        MailService::send(MailMessage{"", "subject", "body"}, [&](MailResult result) {
            ++calls;
            observed = result;
        });
        REQUIRE(calls == 1);
        REQUIRE(observed == MailResult::Failed);
    }

    SECTION("an overridden sender receives the message and drives the result") {
        std::vector<MailMessage> captured;
        auto previous = MailService::overrideSender(
            [&captured](const MailMessage& message, std::function<void(MailResult)> callback) {
                captured.push_back(message);
                callback(MailResult::Delivered);
            });

        MailResult observed = MailResult::Failed;
        MailService::send(
            MailMessage{"to@example.test", "reset", "the token is inside"}, [&](MailResult result) {
                observed = result;
            });

        MailService::restoreSender(previous);

        REQUIRE(captured.size() == 1);
        REQUIRE(captured[0].to == "to@example.test");
        REQUIRE(captured[0].subject == "reset");
        // The override is how a test observes what *would* have been sent, which
        // is the only way to check a reset token reached the message.
        REQUIRE(captured[0].body.find("the token is inside") != std::string::npos);
        REQUIRE(observed == MailResult::Delivered);
    }

    SECTION("restoring the default sender puts the log transport back") {
        auto previous = MailService::overrideSender(
            [](const MailMessage&, std::function<void(MailResult)> callback) {
                callback(MailResult::Delivered);
            });
        MailService::restoreSender(previous);

        MailResult observed = MailResult::Delivered;
        MailService::send(MailMessage{"to@example.test", "s", "b"},
                          [&](MailResult result) { observed = result; });
        REQUIRE(observed == MailResult::Logged);
    }
}
