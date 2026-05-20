data "aws_availability_zones" "available" {
  count = length(var.availability_zones) == 0 ? 1 : 0
  state = "available"
}

locals {
  azs              = length(var.availability_zones) > 0 ? var.availability_zones : slice(data.aws_availability_zones.available[0].names, 0, 3)
  public_subnets   = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i)]       # /24
  private_subnets  = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 6, i + 10)]  # /22
  isolated_subnets = [for i, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 100)] # /24
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "s2s-m2m-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "s2s-m2m-igw" }
}

resource "aws_subnet" "public" {
  count                   = length(local.azs)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_subnets[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "s2s-m2m-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnets[count.index]
  availability_zone = local.azs[count.index]

  tags = { Name = "s2s-m2m-private-${count.index}" }
}

resource "aws_subnet" "isolated" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.isolated_subnets[count.index]
  availability_zone = local.azs[count.index]

  tags = { Name = "s2s-m2m-isolated-${count.index}" }
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "s2s-m2m-nat-eip" }
}

resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "s2s-m2m-nat" }
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "s2s-m2m-rt-public" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }
  tags = { Name = "s2s-m2m-rt-private" }
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Isolated subnets get a route table with no default route.
resource "aws_route_table" "isolated" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "s2s-m2m-rt-isolated" }
}

resource "aws_route_table_association" "isolated" {
  count          = length(aws_subnet.isolated)
  subnet_id      = aws_subnet.isolated[count.index].id
  route_table_id = aws_route_table.isolated.id
}

# --- KMS for at-rest encryption ---------------------------------------------

resource "aws_kms_key" "valkey_at_rest" {
  description             = "Valkey at-rest CMK"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "valkey_at_rest" {
  name          = "alias/s2s-m2m-valkey-at-rest"
  target_key_id = aws_kms_key.valkey_at_rest.key_id
}

# --- Security groups --------------------------------------------------------

resource "aws_security_group" "workload" {
  name        = "s2s-m2m-workload"
  description = "M2M workloads allowed to talk to Valkey"
  vpc_id      = aws_vpc.this.id

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "cache" {
  name        = "s2s-m2m-cache"
  description = "Valkey cache: inbound 6379 from workload SG only"
  vpc_id      = aws_vpc.this.id
}

resource "aws_security_group_rule" "cache_ingress_from_workload" {
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.cache.id
  source_security_group_id = aws_security_group.workload.id
  description              = "Valkey from workloads only"
}

# --- Valkey serverless cache ------------------------------------------------

resource "aws_elasticache_serverless_cache" "valkey" {
  engine               = "valkey"
  name                 = "s2s-m2m-valkey"
  description          = "M2M token + DPoP nonce cache (TLS, KMS-CMK, private)"
  major_engine_version = "7"
  kms_key_id           = aws_kms_key.valkey_at_rest.arn
  security_group_ids   = [aws_security_group.cache.id]
  subnet_ids           = aws_subnet.isolated[*].id
}
