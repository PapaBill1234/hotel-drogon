cmake_minimum_required(VERSION 3.20)
project(hotel_drogon VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Export compile_commands.json for language servers / linters
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Compiler warnings
if(MSVC)
    add_compile_options(/W4 /permissive-)
else()
    add_compile_options(
        -Wall
        -Wextra
        -Wpedantic
        -Wshadow
        -Wnon-virtual-dtor
        -Wold-style-cast
        -Wcast-align
        -Wunused
        -Woverloaded-virtual
        -Wformat=2
    )
endif()

# Sanitizers option (AddressSanitizer and UndefinedBehaviorSanitizer)
option(ENABLE_SANITIZERS "Enable AddressSanitizer and UndefinedBehaviorSanitizer" OFF)
if(ENABLE_SANITIZERS)
    if(MSVC)
        add_compile_options(/fsanitize=address)
    else()
        add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
        add_link_options(-fsanitize=address,undefined)
    endif()
endif()

# Dependencies
find_package(Drogon CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(spdlog CONFIG REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(Catch2 3 CONFIG QUIET)

find_library(CRYPT_LIB crypt)

# Include directories
include_directories(
    ${PROJECT_SOURCE_DIR}/include
)

# Core library (services, controllers, filters, models, utils)
# Using OBJECT library ensures Drogon HTTP controller macro registrations are retained by the linker
file(GLOB_RECURSE CORE_SOURCES
    "src/controllers/*.cpp"
    "src/services/*.cpp"
    "src/models/*.cpp"
    "src/filters/*.cpp"
    "src/plugins/*.cpp"
    "src/utils/*.cpp"
)

# Explicitly list test controller for debugging JSON
list(APPEND CORE_SOURCES "src/controllers/TestController.cpp")

add_library(hotel_core OBJECT
    ${CORE_SOURCES}
)

target_include_directories(hotel_core PUBLIC
    ${PROJECT_SOURCE_DIR}/include
)

target_link_libraries(hotel_core PUBLIC
    Drogon::Drogon
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    OpenSSL::Crypto
    $<$<BOOL:${CRYPT_LIB}>:${CRYPT_LIB}>
)

# Main HTTP / WebSocket Server binary
add_executable(hotel_server
    src/main.cpp
    $<TARGET_OBJECTS:hotel_core>
)

target_link_libraries(hotel_server PRIVATE
    Drogon::Drogon
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    crypto
    crypt
)

# Background Worker binary
add_executable(hotel_worker
    src/worker/worker_main.cpp
    $<TARGET_OBJECTS:hotel_core>
)

target_link_libraries(hotel_worker PRIVATE
    Drogon::Drogon
    nlohmann_json::nlohmann_json
    spdlog::spdlog
    crypto
    crypt
)

# Unit & Integration Tests
option(BUILD_TESTING "Build the test suite" ON)
if(BUILD_TESTING)
    enable_testing()
    file(GLOB_RECURSE TEST_SOURCES
        "tests/*.cpp"
    )
    if(TEST_SOURCES)
        add_executable(hotel_tests
            ${TEST_SOURCES}
            $<TARGET_OBJECTS:hotel_core>
        )
        if(TARGET Catch2::Catch2WithMain)
            target_link_libraries(hotel_tests PRIVATE
                Drogon::Drogon
                nlohmann_json::nlohmann_json
                spdlog::spdlog
                Catch2::Catch2WithMain
                crypto
                crypt
            )
        elseif(TARGET Catch2::Catch2)
            target_link_libraries(hotel_tests PRIVATE
                Drogon::Drogon
                nlohmann_json::nlohmann_json
                spdlog::spdlog
                Catch2::Catch2
                crypto
                crypt
            )
        else()
            target_link_libraries(hotel_tests PRIVATE
                Drogon::Drogon
                nlohmann_json::nlohmann_json
                spdlog::spdlog
                crypto
                crypt
            )
        endif()
        add_test(NAME hotel_all_tests COMMAND hotel_tests)
    endif()
endif()
