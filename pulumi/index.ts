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

const engineVersion = gcp.container.getEngineVersions().then(v => v.latestMasterVersion);
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

// Export the app deployment name so we can easily access it.
export let appName2 = appDeployment2.metadata.name;

// Export the service's IP address.
export let appAddress2 = appService2.status.apply(s => `http://${s.loadBalancer.ingress[0].ip}:${appPort}`);

const service = new fastly.Servicev1("emojibot", {
    backends: [{
         address: appAddress,
         name: `emojibot-${gcp.config.zone}`,
         port: appPort
     },
     {
        address: appAddress2,
        name: `emojibot-${failoverZone}`,
        port: appPort
    }],
    domains: [{
         comment: "demo app. we may use this to create github applications.",
         name: "emojibot.moment.dev",
    }],
    forceDestroy: true,
  });
