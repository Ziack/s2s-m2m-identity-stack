###############################################################################
# examples/_bootstrap — minimal VPC + subnets + IGW + NAT + route tables.
#
# Run this ONCE per dev/PoC account before applying examples/_platform/. Real
# prod deployments should bring their own VPC and skip this root entirely.
#
# Single-AZ NAT — fine for PoC, but it is a SPOF. Multi-AZ NAT (one per AZ)
# is the prod-grade shape and is intentionally out of scope here.
###############################################################################

provider "aws" {
  region = var.region
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Two AZs is the minimum the s2s-platform ALB + ECS service want.
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  name_prefix = "s2s-${var.environment}"

  base_tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "examples/_bootstrap"
  })
}

###############################################################################
# VPC
###############################################################################

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.base_tags, {
    Name = "${local.name_prefix}-vpc"
  })
}

###############################################################################
# Subnets — two public (/20), two private (/20), across two AZs.
#
# cidrsubnet(10.0.0.0/16, 4, n) carves /20 slots:
#   n=0 → 10.0.0.0/20    public  AZ a
#   n=1 → 10.0.16.0/20   public  AZ b
#   n=2 → 10.0.32.0/20   private AZ a
#   n=3 → 10.0.48.0/20   private AZ b
###############################################################################

resource "aws_subnet" "public" {
  for_each = { for idx, az in local.azs : idx => az }

  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, each.key)
  availability_zone       = each.value
  map_public_ip_on_launch = true

  tags = merge(local.base_tags, {
    Name = "${local.name_prefix}-public-${each.value}"
    Tier = "public"
  })
}

resource "aws_subnet" "private" {
  for_each = { for idx, az in local.azs : idx => az }

  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, each.key + length(local.azs))
  availability_zone = each.value

  tags = merge(local.base_tags, {
    Name = "${local.name_prefix}-private-${each.value}"
    Tier = "private"
  })
}

###############################################################################
# Internet Gateway + NAT (single AZ — SPOF, documented in README)
###############################################################################

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = merge(local.base_tags, {
    Name = "${local.name_prefix}-igw"
  })
}

resource "aws_eip" "nat" {
  domain = "vpc"

  tags = merge(local.base_tags, {
    Name = "${local.name_prefix}-nat-eip"
  })

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  # Park the NAT in the first public subnet. Single-AZ on purpose.
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id

  tags = merge(local.base_tags, {
    Name = "${local.name_prefix}-nat"
  })

  depends_on = [aws_internet_gateway.this]
}

###############################################################################
# Route tables
###############################################################################

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(local.base_tags, {
    Name = "${local.name_prefix}-public-rt"
    Tier = "public"
  })
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }

  tags = merge(local.base_tags, {
    Name = "${local.name_prefix}-private-rt"
    Tier = "private"
  })
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}
