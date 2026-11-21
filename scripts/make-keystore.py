#!/usr/bin/env python3
"""
Creates the SONO-STRUCT release signing keystore as PKCS#12 (.p12).

Android's Gradle plugin accepts a PKCS#12 store directly, so we use the standard
container instead of hand-rolling JKS bytes. Output is committed so CI — and
anyone rebuilding from source — can produce an installable, upgrade-compatible
release APK that shares one signing identity.

This is a PUBLIC distribution key for sideloading. Never use it for Play Store
uploads; generate a private key and keep it in a secret if you do.

    python3 scripts/make-keystore.py [out.p12]

Verification (independent of this script) with OpenSSL:

    openssl pkcs12 -in android/keystore/sonostruct-release.p12 \
        -passin pass:sonostruct-release -info -noout
"""

import os
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
import datetime

ALIAS = "sonostruct"
PASSWORD = b"sonostruct-release"
OUT = sys.argv[1] if len(sys.argv) > 1 else "android/keystore/sonostruct-release.p12"
DAYS = 365 * 30

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

name = x509.Name(
    [
        x509.NameAttribute(NameOID.COMMON_NAME, "SonoStruct NDT Release"),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "Acoustic NDT"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "SonoStruct"),
        x509.NameAttribute(NameOID.COUNTRY_NAME, "KE"),
    ]
)

now = datetime.datetime.now(datetime.timezone.utc)
cert = (
    x509.CertificateBuilder()
    .subject_name(name)
    .issuer_name(name)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now - datetime.timedelta(days=1))
    .not_valid_after(now + datetime.timedelta(days=DAYS))
    .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
    .add_extension(
        x509.KeyUsage(
            digital_signature=True,
            content_commitment=False,
            key_encipherment=False,
            data_encipherment=False,
            key_agreement=False,
            key_cert_sign=False,
            crl_sign=False,
            encipher_only=False,
            decipher_only=False,
        ),
        critical=True,
    )
    .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.CODE_SIGNING]), critical=False)
    .sign(key, hashes.SHA256())
)

blob = pkcs12.serialize_key_and_certificates(
    name=ALIAS.encode("utf-8"),
    key=key,
    cert=cert,
    cas=None,
    encryption_algorithm=serialization.BestAvailableEncryption(PASSWORD),
)

os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
with open(OUT, "wb") as fh:
    fh.write(blob)

# Self-check: reload the container we just wrote and confirm the key round-trips.
k2, c2, _ = pkcs12.load_key_and_certificates(blob, PASSWORD)
assert k2 is not None and c2 is not None
assert k2.private_numbers() == key.private_numbers()
assert c2.fingerprint(hashes.SHA256()) == cert.fingerprint(hashes.SHA256())

print(f"wrote {OUT} ({len(blob)} bytes)")
print(f"  alias     : {ALIAS}")
print(f"  storepass : {PASSWORD.decode()}")
print(f"  valid     : {DAYS} days")
print(f"  sha256    : {cert.fingerprint(hashes.SHA256()).hex()}")
print("self-check: pkcs12 reload + key/cert match OK")
