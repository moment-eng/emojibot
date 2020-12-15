import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import * as docker from "@pulumi/docker";
import * as fastly from "@pulumi/fastly";

const name = "emojibot";

// We will create two GKE Clusters to similuate failover.

///////////////
// Cluster #1
// Located in us-west1-a by default.
///////////////

// Don't use the latest, as us-central-1a gets upgraded last.
// See https://cloud.google.com/kubernetes-engine/versioning-and-upgrades#rollout_schedule for rollout schedule. 
const engineVersion = gcp.container.getEngineVersions().then(v => v.defaultClusterVersion);

const cluster1 = new gcp.container.Cluster(name, {
    initialNodeCount: 2,
    minMasterVersion: engineVersion,
    nodeVersion: engineVersion,
    nodeConfig: {
        machineType: "n1-standard-1",
        oauthScopes: [
            "https://www.googleapis.com/auth/compute",
            "https://www.googleapis.com/auth/devstorage.read_only",
            "https://www.googleapis.com/auth/logging.write",
            "https://www.googleapis.com/auth/monitoring"
        ],
    },
});

// Export the Cluster name
export const clusterName1 = cluster1.name;

// Manufacture a GKE-style kubeconfig. Note that this is slightly "different"
// because of the way GKE requires gcloud to be in the picture for cluster
// authentication (rather than using the client cert/key directly).
export const kubeconfig1 = pulumi.
    all([ cluster1.name, cluster1.endpoint, cluster1.masterAuth ]).
    apply(([ name, endpoint, masterAuth ]) => {
        const context = `${gcp.config.project}_${gcp.config.zone}_${name}`;
        return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${masterAuth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp
`;
    });


// Create a Kubernetes provider instance that uses our cluster from above.
const clusterProvider1 = new k8s.Provider(name, {
    kubeconfig: kubeconfig1,
});

///////////////
// Cluster #2
// Located in us-central1-a.
///////////////

const failoverZone = "us-central1-a"

const cluster2 = new gcp.container.Cluster(`${name}-${failoverZone}`, {
    initialNodeCount: 2,
    minMasterVersion: engineVersion,
    nodeVersion: engineVersion,
    location: failoverZone,
    nodeConfig: {
        machineType: "n1-standard-1",
        oauthScopes: [
            "https://www.googleapis.com/auth/compute",
            "https://www.googleapis.com/auth/devstorage.read_only",
            "https://www.googleapis.com/auth/logging.write",
            "https://www.googleapis.com/auth/monitoring"
        ],
    },
});

// Export the Cluster name
export const clusterName2 = cluster2.name;

// Manufacture a GKE-style kubeconfig. Note that this is slightly "different"
// because of the way GKE requires gcloud to be in the picture for cluster
// authentication (rather than using the client cert/key directly).
export const kubeconfig2 = pulumi.
    all([ cluster2.name, cluster2.endpoint, cluster2.masterAuth ]).
    apply(([ name, endpoint, masterAuth ]) => {
        const context = `${gcp.config.project}_${failoverZone}_${name}`;
        return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${masterAuth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp
`;
    });

// Create a Kubernetes provider instance that uses our cluster from above.
const clusterProvider2 = new k8s.Provider(`${name}-${failoverZone}`, {
    kubeconfig: kubeconfig2,
});

///////////////
// Build Image
///////////////

// Build a Docker image for emojibot and put it to Google Container Registry.
// Note: Run `gcloud auth configure-docker` in your command line to configure auth to GCR.
const imageName = "emojibot";
const img = new docker.Image(imageName, {
    imageName: pulumi.interpolate`gcr.io/${gcp.config.project}/${imageName}:v1.0.0`,
    build: {
        // The Dockerfile lives on the outside parent
        context: "../",
    },
});

// Deploy the emojibot container as a Kubernetes load balanced service.
const appPort = 8080;
const appLabels = { app: "emojibot" };

//////////////
// Deploy to Cluster #1
///////////////

const appDeployment = new k8s.apps.v1.Deployment("emojibot-deployment", {
    spec: {
        selector: { matchLabels: appLabels },
        replicas: 1,
        template: {
            metadata: { labels: appLabels },
            spec: {
                containers: [{
                    name: "emojibot",
                    image: img.imageName,
                    ports: [{ containerPort: appPort }],
                    // env: [{
                    //     name: "FAIL_HEALTHCHECK",
                    //     value: "1"
                    // }]
                }],
            },
        },
    },
}, { provider: clusterProvider1 });

const appService = new k8s.core.v1.Service("emojibot-service", {
    metadata: { labels: appDeployment.metadata.labels },
    spec: {
        type: "LoadBalancer",
        ports: [{ port: appPort, targetPort: appPort }],
        selector: appDeployment.spec.template.metadata.labels,
    },
}, { provider: clusterProvider1 });

// Export the app deployment name so we can easily access it.
export let appName = appDeployment.metadata.name;

// Export the service's IP address.
export let appAddress = appService.status.apply(s => `http://${s.loadBalancer.ingress[0].ip}:${appPort}`);

//////////////
// Deploy to Cluster #2
///////////////

const appDeployment2 = new k8s.apps.v1.Deployment(`emojibot-deployment-${failoverZone}`, {
    spec: {
        selector: { matchLabels: appLabels },
        replicas: 1,
        template: {
            metadata: { labels: appLabels },
            spec: {
                containers: [{
                    name: "emojibot",
                    image: img.imageName,
                    ports: [{ containerPort: appPort }],
                }],
            },
        },
    },
}, { provider: clusterProvider2 });

const appService2 = new k8s.core.v1.Service(`emojibot-service-${failoverZone}`, {
    metadata: { labels: appDeployment.metadata.labels },
    spec: {
        type: "LoadBalancer",
        ports: [{ port: appPort, targetPort: appPort }],
        selector: appDeployment.spec.template.metadata.labels,
    },
}, { provider: clusterProvider2 });

// // Export the app deployment name so we can easily access it.
// export let appName2 = appDeployment2.metadata.name;

// Export the service's IP address.
export let appAddress2 = appService2.status.apply(s => `http://${s.loadBalancer.ingress[0].ip}:${appPort}`);

const service = new fastly.Servicev1("emojibot", {
    backends: [
        {
            address: appAddress,
            name: `emojibot-${gcp.config.zone}`,
            port: appPort,
        },
        {
            address: appAddress2,
            name: `emojibot-${failoverZone}`,
            port: appPort,
        },
    ],
    domains: [
        {
            comment: "demo app. we may use this to create github applications.",
            name: "emojibot.moment.dev",
        },
    ],
    conditions: [
        {
            name: "Primary Down",
            priority: 11,
            statement: "req.restarts > 0 || !req.backend.healthy",
            type: "REQUEST",
        },
    ],
    headers: [
        {
            action: "set",
            destination: "backend",
            ignoreIfSet: false,
            name: "Set Default Origin",
            priority: 10,
            source: "F_emojibot_us_west1_a",
            type: "request",
        },
        {
            action: "set",
            destination: "backend",
            ignoreIfSet: false,
            name: "Set Failover Origin",
            priority: 11,
            requestCondition: "Primary Down",
            source: "F_emojibot_us_central1_a",
            type: "request",
        },
    ],
    healthchecks: [
        {
            checkInterval: 2000,
            expectedResponse: 200,
            host: "emojibot.moment.dev",
            httpVersion: "1.1",
            initial: 9,
            method: "POST",
            name: "Generic Healthcheck",
            path: "/healthcheck",
            threshold: 7,
            timeout: 5000,
            window: 10,
        },
    ],
    loggingDatadogs: [
        {
            format:
                '{\n    "ddsource": "fastly",\n    "service": "%{req.service_id}V",\n    "date": "%{begin:%Y-%m-%dT%H:%M:%S%z}t",\n    "time_start": "%{begin:%Y-%m-%dT%H:%M:%S%Z}t",\n    "time_end": "%{end:%Y-%m-%dT%H:%M:%S%Z}t",\n    "http": {\n      "request_time_ms": %D,\n      "method": "%m",\n      "url": "%{json.escape(req.url)}V",\n      "useragent": "%{User-Agent}i",\n      "referer": "%{Referer}i",\n      "protocol": "%H",\n      "request_x_forwarded_for": "%{X-Forwarded-For}i",\n      "status_code": "%s"\n    },\n    "network": {\n      "client": {\n       "ip": "%h",\n       "name": "%{client.as.name}V",\n       "number": "%{client.as.number}V",\n       "connection_speed": "%{client.geo.conn_speed}V"\n      },\n     "destination": {\n       "ip": "%A"\n      },\n    "geoip": {\n    "geo_city": "%{client.geo.city.utf8}V",\n    "geo_country_code": "%{client.geo.country_code}V",\n    "geo_continent_code": "%{client.geo.continent_code}V",\n    "geo_region": "%{client.geo.region}V"\n    },\n    "bytes_written": %B,\n    "bytes_read": %{req.body_bytes_read}V\n    },\n    "host": "%{Fastly-Orig-Host}i",\n    "origin_host": "%v",\n    "is_ipv6": %{if(req.is_ipv6, "true", "false")}V,\n    "is_tls": %{if(req.is_ssl, "true", "false")}V,\n    "tls_client_protocol": "%{json.escape(tls.client.protocol)}V",\n    "tls_client_servername": "%{json.escape(tls.client.servername)}V",\n    "tls_client_cipher": "%{json.escape(tls.client.cipher)}V",\n    "tls_client_cipher_sha": "%{json.escape(tls.client.ciphers_sha)}V",\n    "tls_client_tlsexts_sha": "%{json.escape(tls.client.tlsexts_sha)}V",\n    "is_h2": %{if(fastly_info.is_h2, "true", "false")}V,\n    "is_h2_push": %{if(fastly_info.h2.is_push, "true", "false")}V,\n    "h2_stream_id": "%{fastly_info.h2.stream_id}V",\n    "request_accept_content": "%{Accept}i",\n    "request_accept_language": "%{Accept-Language}i",\n    "request_accept_encoding": "%{Accept-Encoding}i",\n    "request_accept_charset": "%{Accept-Charset}i",\n    "request_connection": "%{Connection}i",\n    "request_dnt": "%{DNT}i",\n    "request_forwarded": "%{Forwarded}i",\n    "request_via": "%{Via}i",\n    "request_cache_control": "%{Cache-Control}i",\n    "request_x_requested_with": "%{X-Requested-With}i",\n    "request_x_att_device_id": "%{X-ATT-Device-Id}i",\n    "content_type": "%{Content-Type}o",\n    "is_cacheable": %{if(fastly_info.state~"^(HIT|MISS)$", "true","false")}V,\n    "response_age": "%{Age}o",\n    "response_cache_control": "%{Cache-Control}o",\n    "response_expires": "%{Expires}o",\n    "response_last_modified": "%{Last-Modified}o",\n    "response_tsv": "%{TSV}o",\n    "server_datacenter": "%{server.datacenter}V",\n    "req_header_size": %{req.header_bytes_read}V,\n    "resp_header_size": %{resp.header_bytes_written}V,\n    "socket_cwnd": %{client.socket.cwnd}V,\n    "socket_nexthop": "%{client.socket.nexthop}V",\n    "socket_tcpi_rcv_mss": %{client.socket.tcpi_rcv_mss}V,\n    "socket_tcpi_snd_mss": %{client.socket.tcpi_snd_mss}V,\n    "socket_tcpi_rtt": %{client.socket.tcpi_rtt}V,\n    "socket_tcpi_rttvar": %{client.socket.tcpi_rttvar}V,\n    "socket_tcpi_rcv_rtt": %{client.socket.tcpi_rcv_rtt}V,\n    "socket_tcpi_rcv_space": %{client.socket.tcpi_rcv_space}V,\n    "socket_tcpi_last_data_sent": %{client.socket.tcpi_last_data_sent}V,\n    "socket_tcpi_total_retrans": %{client.socket.tcpi_total_retrans}V,\n    "socket_tcpi_delta_retrans": %{client.socket.tcpi_delta_retrans}V,\n    "socket_ploss": %{client.socket.ploss}V\n  }',
            formatVersion: 2,
            name: "DDOG logging endpoint",
            region: "US",
            token: "8f970a6b3cfbc15370de6ef56c0af1fe",
        },
    ],
    snippets: [
        {
            content:
                ' if (obj.status == 610) {\n  # 0 = unhealthy, 1 = healthy\n  synthetic "{" LF\n      {"  "timestamp": ""} now {"","} LF\n      {"  "F_emojibot_us_central1_a": "} backend.F_emojibot_us_central1_a.healthy {","} LF\n      {"  "F_emojibot_us_west1_a": "} backend.F_emojibot_us_west1_a.healthy LF\n      "}";\n  set obj.status = 200;\n  set obj.response = "OK";\n  set obj.http.content-type = "application/json";\n  set obj.http.x-hcstatus-F_emojibot_us_central1_a = backend.F_emojibot_us_central1_a.healthy;\n  set obj.http.x-hcstatus-F_emojibot_us_west1_a = backend.F_emojibot_us_west1_a.healthy;\n  return (deliver);\n}\n\n',
            name: "Health Status error",
            priority: 100,
            type: "error",
        },
        {
            content: 'if (req.url.path ~ "^/fastly/api/hc-status") {\n  error 610;\n}\n\n',
            name: "Health Status recv",
            priority: 100,
            type: "recv",
        },
    ],
    forceDestroy: true,
});
