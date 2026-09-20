# Minimal PHP runtime for the legacy PHPRetro app, used ONLY to capture
# visual-parity baselines. Not part of the production stack.
FROM php:8.2-apache

RUN docker-php-ext-install pdo_mysql mysqli \
 && a2enmod rewrite headers

# The legacy app relies on per-directory configuration.
RUN sed -ri 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# Match the original deployment closely enough for layout purposes.
RUN { \
      echo 'date.timezone = UTC'; \
      echo 'display_errors = On'; \
      echo 'error_reporting = E_ALL & ~E_DEPRECATED & ~E_NOTICE'; \
      echo 'short_open_tag = Off'; \
    } > /usr/local/etc/php/conf.d/legacy.ini

WORKDIR /var/www/html
