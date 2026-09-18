#include <iostream>
#include "utils/Crypto.h"

using namespace hotel::utils;

int main() {
    std::string password = "secretpass";
    std::string username = "TestUser";
    std::string lowerUser = username;
    std::transform(lowerUser.begin(), lowerUser.end(), lowerUser.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    std::string legacyInput = password + lowerUser;
    std::string legacyHash = Crypto::sha1(legacyInput);
    
    std::cout << "Password: " << password << std::endl;
    std::cout << "Username: " << username << std::endl;
    std::cout << "Lower username: " << lowerUser << std::endl;
    std::cout << "Legacy input: " << legacyInput << std::endl;
    std::cout << "Computed SHA-1: " << legacyHash << std::endl;
    
    auto result = Crypto::verifyPassword(password, legacyHash, username);
    std::cout << "Verified: " << result.verified << std::endl;
    std::cout << "Needs rehash: " << result.needsRehash << std::endl;
    
    return 0;
}
