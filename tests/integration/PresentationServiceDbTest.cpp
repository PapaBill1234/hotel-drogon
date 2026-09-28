#include <catch2/catch_test_macros.hpp>

#include "services/PresentationService.h"

#include <chrono>
#include <cstdlib>
#include <future>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>

namespace {

using hotel::services::PresentationService;
using hotel::services::PresentationServiceCode;
using hotel::services::PresentationServiceResult;

constexpr auto kCallbackTimeout = std::chrono::seconds(15);

PresentationServiceResult waitForResult(
    std::future<PresentationServiceResult>& future) {
    if (future.wait_for(kCallbackTimeout) != std::future_status::ready) {
        throw std::runtime_error("presentation service callback timed out");
    }
    return future.get();
}

std::future<PresentationServiceResult> save(
    const drogon::orm::DbClientPtr& db,
    uint32_t actorId,
    const std::string& documentKey,
    uint32_t expectedRevision,
    const Json::Value& document) {
    auto promise = std::make_shared<std::promise<PresentationServiceResult>>();
    auto future = promise->get_future();
    PresentationService::saveDraft(
        db, actorId, documentKey, expectedRevision, document, "127.0.0.1",
        [promise](PresentationServiceResult result) {
            promise->set_value(std::move(result));
        });
    return future;
}

std::future<PresentationServiceResult> load(
    const drogon::orm::DbClientPtr& db,
    const std::string& documentKey) {
    auto promise = std::make_shared<std::promise<PresentationServiceResult>>();
    auto future = promise->get_future();
    PresentationService::loadDraft(
        db, documentKey, [promise](PresentationServiceResult result) {
            promise->set_value(std::move(result));
        });
    return future;
}

Json::Value pageDocument(const std::string& path, const std::string& textKey) {
    Json::Value document(Json::objectValue);
    document["path"] = path;
    // The service owns revision allocation and replaces this placeholder.
    document["revision"] = 999U;
    document["slots"] = Json::Value(Json::arrayValue);
    if (!textKey.empty()) {
        Json::Value slot(Json::objectValue);
        slot["key"] = "intro";
        slot["visibility"] = "everyone";
        slot["order"] = 0;
        slot["block"]["type"] = "paragraph";
        slot["block"]["textKey"] = textKey;
        document["slots"].append(slot);
    }
    return document;
}

uint64_t countRevisionsForKey(const drogon::orm::DbClientPtr& db,
                              const std::string& documentKey) {
    const auto result = db->execSqlSync(
        "SELECT COUNT(*) AS total FROM phpretro_presentation_revisions "
        "WHERE document_key = ?",
        documentKey);
    return result[0]["total"].as<uint64_t>();
}

}  // namespace

TEST_CASE("Presentation drafts persist with CAS and atomic audit",
          "[presentation-db]") {
    const char* host = std::getenv("PRESENTATION_TEST_DB_HOST");
    const char* database = std::getenv("PRESENTATION_TEST_DB_DATABASE");
    if (host == nullptr || *host == '\0' || database == nullptr || *database == '\0') {
        SKIP("Set PRESENTATION_TEST_DB_HOST and PRESENTATION_TEST_DB_DATABASE to run disposable MariaDB integration checks");
    }
    REQUIRE(std::string(database) == "presentation_test");

    const char* portText = std::getenv("PRESENTATION_TEST_DB_PORT");
    const int port = portText == nullptr ? 3306 : std::stoi(portText);
    const char* username = std::getenv("PRESENTATION_TEST_DB_USERNAME");
    const char* password = std::getenv("PRESENTATION_TEST_DB_PASSWORD");
    const std::string dbUser = username == nullptr ? "hotel" : username;
    const std::string dbPassword = password == nullptr ? "hotel_secret" : password;

    const std::string connectionInfo =
        "host=" + std::string(host) + " port=" + std::to_string(port) +
        " dbname=" + database + " user=" + dbUser + " password=" + dbPassword;
    const auto db = drogon::orm::DbClient::newMysqlClient(connectionInfo, 4);
    REQUIRE(db != nullptr);
    db->setTimeout(5.0);

    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS users ("
        "id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    db->execSqlSync("INSERT IGNORE INTO users (id) VALUES (22), (23)");
    db->execSqlSync(
        "CREATE TABLE IF NOT EXISTS phpretro_admin_action_log ("
        "id INT NOT NULL AUTO_INCREMENT, admin_id INT NOT NULL, "
        "action_type VARCHAR(100) NOT NULL, target_type VARCHAR(100) NOT NULL, "
        "target_id INT NULL, details TEXT NOT NULL, ip VARCHAR(45) NOT NULL, "
        "created_at INT NOT NULL, PRIMARY KEY (id), "
        "INDEX idx_admin_created (admin_id, created_at), "
        "INDEX idx_target (target_type, target_id), "
        "CONSTRAINT fk_phpretro_audit_admin FOREIGN KEY (admin_id) "
        "REFERENCES users(id) ON DELETE RESTRICT) "
        "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    auto schemaPromise = std::make_shared<std::promise<void>>();
    auto schemaFuture = schemaPromise->get_future();
    PresentationService::ensureSchema(db, [schemaPromise]() {
        schemaPromise->set_value();
    });
    REQUIRE(schemaFuture.wait_for(kCallbackTimeout) == std::future_status::ready);
    schemaFuture.get();

    const auto micros = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    const uint32_t articleId = static_cast<uint32_t>(
        static_cast<uint64_t>(micros) % 2147483646U + 1U);
    const std::string path = "/articles/" + std::to_string(articleId);
    const std::string documentKey = "page:" + path;

    auto missingFuture = load(db, documentKey);
    const auto missing = waitForResult(missingFuture);
    REQUIRE_FALSE(missing.ok);
    REQUIRE(missing.code == PresentationServiceCode::NotFound);

    auto createFuture = save(db, 22, documentKey, 0, pageDocument(path, "draft.one"));
    const auto created = waitForResult(createFuture);
    REQUIRE(created.ok);
    REQUIRE(created.revision == 1);

    auto readFuture = load(db, documentKey);
    const auto loaded = waitForResult(readFuture);
    REQUIRE(loaded.ok);
    REQUIRE(loaded.document.has_value());
    REQUIRE(loaded.document->contract_version == 1);
    REQUIRE(loaded.document->revision == 1);
    REQUIRE(loaded.document->contents["revision"].asUInt() == 1);
    REQUIRE(loaded.document->contents["path"].asString() == path);

    auto duplicateCreateFuture = save(db, 22, documentKey, 0, pageDocument(path, "draft.duplicate"));
    const auto duplicateCreate = waitForResult(duplicateCreateFuture);
    REQUIRE_FALSE(duplicateCreate.ok);
    REQUIRE(duplicateCreate.code == PresentationServiceCode::Conflict);
    REQUIRE(countRevisionsForKey(db, documentKey) == 1);

    auto mismatched = pageDocument("/community", "draft.mismatch");
    auto invalidFuture = save(db, 22, documentKey, 1, mismatched);
    const auto invalid = waitForResult(invalidFuture);
    REQUIRE_FALSE(invalid.ok);
    REQUIRE(invalid.code == PresentationServiceCode::InvalidInput);

    // Two writers with the same expected revision must produce one revision
    // and one conflict, regardless of which request obtains the row first.
    auto concurrentA = save(db, 22, documentKey, 1, pageDocument(path, "draft.concurrent.a"));
    auto concurrentB = save(db, 23, documentKey, 1, pageDocument(path, "draft.concurrent.b"));
    const auto resultA = waitForResult(concurrentA);
    const auto resultB = waitForResult(concurrentB);
    REQUIRE(((resultA.ok && resultB.code == PresentationServiceCode::Conflict) ||
             (resultB.ok && resultA.code == PresentationServiceCode::Conflict)));
    REQUIRE(countRevisionsForKey(db, documentKey) == 2);

    const std::string triggerName = "trg_presentation_test_fail_audit";
    db->execSqlSync("DROP TRIGGER IF EXISTS " + triggerName);
    db->execSqlSync(
        "CREATE TRIGGER " + triggerName +
        " BEFORE INSERT ON phpretro_admin_action_log FOR EACH ROW "
        "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced presentation audit failure'");

    auto auditFailureFuture = save(db, 22, documentKey, 2, pageDocument(path, "draft.audit.failure"));
    const auto auditFailure = waitForResult(auditFailureFuture);
    REQUIRE_FALSE(auditFailure.ok);
    REQUIRE(auditFailure.code == PresentationServiceCode::Unavailable);
    REQUIRE(countRevisionsForKey(db, documentKey) == 2);
    const auto head = db->execSqlSync(
        "SELECT draft_revision FROM phpretro_presentation_documents WHERE document_key = ?",
        documentKey);
    REQUIRE(head[0]["draft_revision"].as<uint32_t>() == 2);
    const auto auditCount = db->execSqlSync(
        "SELECT COUNT(*) AS total FROM phpretro_admin_action_log "
        "WHERE target_type = 'presentation_document' AND details LIKE ?",
        "%" + documentKey + "%");
    REQUIRE(auditCount[0]["total"].as<uint64_t>() == 2);
    db->execSqlSync("DROP TRIGGER IF EXISTS " + triggerName);

    db->execSqlSync(
        "DELETE FROM phpretro_presentation_revisions "
        "WHERE document_key = ? AND revision = 2",
        documentKey);
    auto corruptDraftFuture = load(db, documentKey);
    const auto corruptDraft = waitForResult(corruptDraftFuture);
    REQUIRE_FALSE(corruptDraft.ok);
    REQUIRE(corruptDraft.code == PresentationServiceCode::Unavailable);

    db->execSqlSync(
        "DELETE FROM phpretro_admin_action_log "
        "WHERE target_type = 'presentation_document' AND details LIKE ?",
        "%" + documentKey + "%");
    db->execSqlSync(
        "DELETE FROM phpretro_presentation_revisions WHERE document_key = ?",
        documentKey);
    db->execSqlSync(
        "DELETE FROM phpretro_presentation_documents WHERE document_key = ?",
        documentKey);
}
