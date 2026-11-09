import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as util from 'util';

const execFile = util.promisify(cp.execFile);

export interface GpuInfo {
    name: string;
    driverVersion: string;
    computeCapability: string;
    eccEnabled: boolean;
    eccStatus: 'enabled' | 'disabled' | 'unsupported' | 'unknown';
    memoryTotalMb: number;
}

export interface PreflightCheckItem {
    id: string;
    title: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    details?: string;
}

export interface PreflightReport {
    timestamp: string;
    platform: string;
    shmSizeMb: number | null;
    gpus: GpuInfo[];
    envVars: Record<string, string | undefined>;
    checks: PreflightCheckItem[];
}

export async function runPreflightChecks(pythonPath?: string): Promise<PreflightReport> {
    const checks: PreflightCheckItem[] = [];
    const gpus: GpuInfo[] = [];
    let shmSizeMb: number | null = null;

    // 1. GPU Detection via nvidia-smi
    try {
        const { stdout } = await execFile('nvidia-smi', [
            '--query-gpu=name,driver_version,compute_cap,ecc.mode.current,memory.total',
            '--format=csv,noheader,nounits'
        ], { timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true });
        const lines = stdout.trim().split('\n').filter(Boolean);
        for (const line of lines) {
            const parts = line.split(',').map(p => p.trim());
            if (parts.length >= 5) {
                const eccEnabled = parts[3].toLowerCase() === 'enabled' || parts[3].toLowerCase() === 'on';
                const eccStatus: GpuInfo['eccStatus'] = /geforce/i.test(parts[0]) || /not supported|n\/a/i.test(parts[3]) ? 'unsupported'
                    : eccEnabled ? 'enabled' : /disabled|off/i.test(parts[3]) ? 'disabled' : 'unknown';
                gpus.push({
                    name: parts[0],
                    driverVersion: parts[1],
                    computeCapability: parts[2],
                    eccEnabled,
                    eccStatus,
                    memoryTotalMb: parseInt(parts[4], 10) || 0
                });
            }
        }

        if (gpus.length > 0) {
            checks.push({
                id: 'gpu-detection',
                title: 'NVIDIA GPU Detection',
                status: 'pass',
                message: `Detected ${gpus.length} GPU(s): ${gpus.map(g => g.name).join(', ')}`
            });

            // Check ECC status
            const nonEccGpus = gpus.filter(g => g.eccStatus === 'disabled' || g.eccStatus === 'unknown');
            if (nonEccGpus.length > 0) {
                checks.push({
                    id: 'gpu-ecc',
                    title: 'GPU ECC Status',
                    status: 'warn',
                    message: `${nonEccGpus.length} GPU(s) report ECC disabled or unknown. Check model support before changing settings. This is not a diagnosis of a hardware fault.`
                });
            } else {
                checks.push({
                    id: 'gpu-ecc',
                    title: 'GPU ECC Status',
                    status: 'pass',
                    message: 'ECC is enabled where reported, or unavailable on this GPU model. Saved-log analysis does not require ECC.'
                });
            }
        } else {
            checks.push({
                id: 'gpu-detection',
                title: 'NVIDIA GPU Detection',
                status: 'warn',
                message: 'nvidia-smi executed but returned no GPUs.'
            });
        }
    } catch (error) {
        checks.push({
            id: 'gpu-detection',
            title: 'NVIDIA GPU Detection',
            status: 'warn',
            message: 'GPU inspection was unavailable on this extension host. Saved-log diagnosis still works without a local GPU or NVIDIA drivers.',
            details: error instanceof Error ? error.message : String(error)
        });
    }

    // 2. Linux /dev/shm Size Check
    if (os.platform() === 'linux') {
        try {
            const stats = await (fs.promises as any).statfs?.('/dev/shm');
            if (stats) {
                const totalBytes = stats.bsize * stats.blocks;
                shmSizeMb = Math.round(totalBytes / (1024 * 1024));

                if (shmSizeMb < 2048) {
                    checks.push({
                        id: 'dev-shm',
                        title: 'Shared Memory (/dev/shm)',
                        status: 'fail',
                        message: `/dev/shm size is ${shmSizeMb}MB (below the 2048MB recommended minimum). This frequently triggers DataLoader worker crashes in PyTorch.`
                    });
                } else {
                    checks.push({
                        id: 'dev-shm',
                        title: 'Shared Memory (/dev/shm)',
                        status: 'pass',
                        message: `/dev/shm size is adequate (${shmSizeMb}MB).`
                    });
                }
            }
        } catch (error) {
            checks.push({
                id: 'dev-shm',
                title: 'Shared Memory (/dev/shm)',
                status: 'warn',
                message: 'Unable to inspect /dev/shm filesystem metrics.',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    } else {
        checks.push({
            id: 'dev-shm',
            title: 'Shared Memory (/dev/shm)',
            status: 'pass',
            message: `Platform is ${os.platform()}; /dev/shm check skipped.`
        });
    }

    // 3. PyTorch & CUDA version alignment probe via python
    const pythonCmd = pythonPath || (os.platform() === 'win32' ? 'python' : 'python3');
    try {
        const { stdout } = await execFile(pythonCmd, [
            '-c',
            'import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.is_available())'
        ], { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true });
        const [torchVer, cudaVer, cudaAvail] = stdout.trim().split('\n').map(s => s.trim());
        const isAvailable = cudaAvail === 'True';

        if (!isAvailable && gpus.length > 0) {
            checks.push({
                id: 'pytorch-cuda',
                title: 'PyTorch & CUDA Alignment',
                status: 'fail',
                message: `PyTorch (v${torchVer}) reports CUDA is not available, despite ${gpus.length} NVIDIA GPU(s) detected. Check CUDA toolkit vs PyTorch build mismatch.`
            });
        } else {
            checks.push({
                id: 'pytorch-cuda',
                title: 'PyTorch & CUDA Alignment',
                status: 'pass',
                message: `PyTorch v${torchVer} linked with CUDA v${cudaVer || 'CPU'} (CUDA Available: ${cudaAvail})`
            });
        }
    } catch (error) {
        checks.push({
            id: 'pytorch-cuda',
            title: 'PyTorch & CUDA Alignment',
            status: 'warn',
            message: `Could not probe PyTorch via ${pythonCmd}. Select your training interpreter or set denpex.pythonPath. Saved-log diagnosis does not require PyTorch.`,
            details: error instanceof Error ? error.message : String(error)
        });
    }

    // 4. Key Environment Variables
    const envVars = {
        NCCL_DEBUG: process.env.NCCL_DEBUG,
        TORCH_DISTRIBUTED_DEBUG: process.env.TORCH_DISTRIBUTED_DEBUG,
        CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES
    };

    if (!envVars.NCCL_DEBUG && gpus.length > 1 && os.platform() === 'linux') {
        checks.push({
            id: 'env-nccl',
            title: 'Environment: NCCL_DEBUG',
            status: 'warn',
            message: 'NCCL_DEBUG is not set. Setting NCCL_DEBUG=INFO is recommended for debugging distributed communication hangs.'
        });
    } else {
        checks.push({
            id: 'env-nccl',
            title: 'Environment: NCCL_DEBUG',
            status: 'pass',
            message: envVars.NCCL_DEBUG ? `NCCL_DEBUG is set to "${envVars.NCCL_DEBUG}".` : 'NCCL debug logging is optional and not required for saved-log analysis.'
        });
    }

    return {
        timestamp: new Date().toISOString(),
        platform: `${os.platform()} ${os.release()} (${os.arch()})`,
        shmSizeMb,
        gpus,
        envVars,
        checks
    };
}
