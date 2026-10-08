import asyncio
import time
from collections import Counter

import aiohttp

# ============================================================
# CONFIGURATION
# ============================================================

URL = "http://127.0.0.1:8000/api/public/voitures"

# Nombre de requêtes simultanées par vague
TESTS = [50, 100, 150, 200, 250, 300, 400, 500, 600]
WAVES = 3

# Critère de capacité : part des requêtes totales ayant reçu une réponse 2xx
# en moins de ce délai.
LATENCY_TARGET = 2.0

# Timeout maximum par requête
TIMEOUT = 30


def percentile(values, percent):
    """Calcule un percentile avec interpolation linéaire."""
    if not values:
        return None

    ordered = sorted(values)
    position = (len(ordered) - 1) * percent / 100
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def format_seconds(value):
    return f"{value:.3f}" if value is not None else "n/a"


async def run_wave(session, concurrent_requests, wave_number):
    print(f"\nVague {wave_number}/{WAVES} — {concurrent_requests} requêtes simultanées")

    semaphore = asyncio.Semaphore(concurrent_requests)
    responses = []
    errors = []

    async def make_request():
        async with semaphore:
            start = time.perf_counter()

            try:
                async with session.get(URL) as response:
                    await response.read()
                    responses.append({
                        "status": response.status,
                        "time": time.perf_counter() - start,
                    })
            except Exception as error:
                errors.append({
                    "type": type(error).__name__,
                    "time": time.perf_counter() - start,
                })

    start_total = time.perf_counter()
    await asyncio.gather(
        *(make_request() for _ in range(concurrent_requests))
    )
    total_time = time.perf_counter() - start_total

    successful = sum(200 <= result["status"] < 300 for result in responses)
    failed_http = len(responses) - successful
    failed_connection = len(errors)
    total_attempts = concurrent_requests
    fast_successful = sum(
        200 <= result["status"] < 300 and result["time"] <= LATENCY_TARGET
        for result in responses
    )
    http_latencies = [result["time"] for result in responses]
    success_rate = successful / total_attempts * 100
    fast_success_rate = fast_successful / total_attempts * 100
    requests_per_second = total_attempts / total_time if total_time else 0

    print(
        f"  OK: {successful} | Échecs HTTP: {failed_http} | "
        f"Erreurs connexion: {failed_connection} | "
        f"Réussite: {success_rate:.2f}%"
    )
    print(
        f"  2xx en <= {LATENCY_TARGET:.1f}s: {fast_success_rate:.2f}% "
        f"({fast_successful}/{total_attempts}) | "
        f"Durée: {total_time:.3f}s | Débit: {requests_per_second:.2f} req/s"
    )
    print(
        "  Latence HTTP — "
        f"P50: {format_seconds(percentile(http_latencies, 50))}s | "
        f"P95: {format_seconds(percentile(http_latencies, 95))}s | "
        f"P99: {format_seconds(percentile(http_latencies, 99))}s"
    )

    return {
        "responses": responses,
        "errors": errors,
        "total_time": total_time,
    }


async def main():
    total_requests = sum(TESTS) * WAVES

    print("=" * 76)
    print("TEST DE CHARGE DU BACKEND GOYING")
    print("=" * 76)
    print(f"URL testée : {URL}")
    print(f"Concurrences : {TESTS}")
    print(f"Vagues par niveau : {WAVES}")
    print(f"Nombre total de requêtes prévues : {total_requests}")
    print(
        "Attention : ce test envoie réellement ces requêtes à l'API et "
        "à Firestore."
    )
    print(
        f"Critère de capacité : au moins 99% des requêtes doivent recevoir "
        f"une réponse 2xx en <= {LATENCY_TARGET:.1f}s."
    )

    timeout = aiohttp.ClientTimeout(total=TIMEOUT)
    connector = aiohttp.TCPConnector(limit=0, limit_per_host=0)
    all_results = []

    async with aiohttp.ClientSession(
        timeout=timeout,
        connector=connector,
    ) as session:
        for concurrency in TESTS:
            aggregate = {
                "responses": [],
                "errors": [],
                "total_time": 0,
            }

            for wave_number in range(1, WAVES + 1):
                result = await run_wave(session, concurrency, wave_number)
                aggregate["responses"].extend(result["responses"])
                aggregate["errors"].extend(result["errors"])
                aggregate["total_time"] += result["total_time"]

                if wave_number < WAVES:
                    await asyncio.sleep(2)

            all_results.append({
                "concurrent": concurrency,
                **aggregate,
            })

    print("\n" + "=" * 126)
    print("RÉSULTATS AGRÉGÉS PAR NIVEAU DE CONCURRENCE")
    print("Percentiles calculés sur les réponses HTTP reçues; erreurs connexion exclues.")
    print("=" * 126)
    print(
        f"{'Req.':>7} {'Vagues':>7} {'OK':>7} {'Échecs':>9} "
        f"{f'2xx <={LATENCY_TARGET:g}s':>11} {'P50(s)':>10} {'P95(s)':>10} "
        f"{'P99(s)':>10} {'Req/s':>10}"
    )
    print("-" * 126)

    for result in all_results:
        responses = result["responses"]
        errors = result["errors"]
        total_attempts = result["concurrent"] * WAVES
        successful = sum(
            200 <= response["status"] < 300 for response in responses
        )
        fast_successful = sum(
            200 <= response["status"] < 300
            and response["time"] <= LATENCY_TARGET
            for response in responses
        )
        failed = total_attempts - successful
        fast_success_rate = fast_successful / total_attempts * 100
        http_latencies = [response["time"] for response in responses]
        requests_per_second = (
            total_attempts / result["total_time"]
            if result["total_time"]
            else 0
        )

        result["successful"] = successful
        result["failed"] = failed
        result["fast_success_rate"] = fast_success_rate
        result["p50"] = percentile(http_latencies, 50)
        result["p95"] = percentile(http_latencies, 95)
        result["p99"] = percentile(http_latencies, 99)
        result["requests_per_second"] = requests_per_second

        print(
            f"{result['concurrent']:>7} {WAVES:>7} {successful:>7} "
            f"{failed:>9} {fast_success_rate:>10.2f}% "
            f"{format_seconds(result['p50']):>10} "
            f"{format_seconds(result['p95']):>10} "
            f"{format_seconds(result['p99']):>10} "
            f"{requests_per_second:>10.2f}"
        )

    print("=" * 126)
    print("\nANALYSE DU CRITÈRE (>= 99% de réponses 2xx en <= 2s) :")

    qualifying_levels = [
        result["concurrent"]
        for result in all_results
        if result["fast_success_rate"] >= 99
    ]

    for result in all_results:
        marker = "OK" if result["fast_success_rate"] >= 99 else "ÉCHEC"
        print(
            f"- {result['concurrent']} simultanées : {marker} "
            f"({result['fast_success_rate']:.2f}% 2xx en "
            f"<= {LATENCY_TARGET:.1f}s)"
        )

    if qualifying_levels:
        print(
            "\nPlus haut niveau testé satisfaisant le critère : "
            f"{max(qualifying_levels)} requêtes simultanées."
        )
        print(
            "Ce résultat vaut uniquement pour cette machine, cette route, "
            "cette configuration et cette durée de test."
        )
    else:
        print(
            "\nAucun niveau testé n'a satisfait le critère. "
            "Réduisez la charge ou examinez les latences et erreurs."
        )

    error_types = Counter(
        error["type"]
        for result in all_results
        for error in result["errors"]
    )
    if error_types:
        print(f"Erreurs de connexion observées : {dict(error_types)}")

    print("\nTest terminé.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nTest interrompu par l'utilisateur.")
