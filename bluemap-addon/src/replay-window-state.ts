export interface ReplayWindowRequest {
  generation: number;
  bucket: number;
}

const bucketFor = (time: number, duration: number): number =>
  Math.floor(time / duration);

export class ReplayWindowState {
  private generation = 0;
  private loadedBucket: number | undefined;
  private pendingBucket: number | undefined;

  reset(): void {
    this.generation++;
    this.loadedBucket = undefined;
    this.pendingBucket = undefined;
  }

  needsLoad(time: number, duration: number): boolean {
    const bucket = bucketFor(time, duration);
    return bucket !== this.loadedBucket && bucket !== this.pendingBucket;
  }

  isLoaded(time: number, duration: number): boolean {
    return bucketFor(time, duration) === this.loadedBucket;
  }

  begin(time: number, duration: number): ReplayWindowRequest {
    const request = {
      generation: ++this.generation,
      bucket: bucketFor(time, duration),
    };
    this.pendingBucket = request.bucket;
    return request;
  }

  isCurrent(request: ReplayWindowRequest): boolean {
    return request.generation === this.generation;
  }

  accept(request: ReplayWindowRequest, time: number, duration: number): boolean {
    return this.isCurrent(request) && request.bucket === bucketFor(time, duration);
  }

  markLoaded(request: ReplayWindowRequest): boolean {
    if (!this.isCurrent(request)) return false;
    this.loadedBucket = request.bucket;
    return true;
  }

  finish(request: ReplayWindowRequest): boolean {
    if (!this.isCurrent(request)) return false;
    this.pendingBucket = undefined;
    return true;
  }
}
